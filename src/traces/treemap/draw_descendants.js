/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var d3 = require('d3');
var Lib = require('../../lib');
var Drawing = require('../../components/drawing');
var svgTextUtils = require('../../lib/svg_text_utils');

var partition = require('./partition');
var styleOne = require('./style').styleOne;
var constants = require('./constants');
var helpers = require('../sunburst/helpers');
var attachFxHandlers = require('../sunburst/fx');
var formatSliceLabel = require('../sunburst/plot').formatSliceLabel;

var upDown = false; // for Descendants

module.exports = function drawDescendants(gd, cd, entry, slices, opts) {
    var width = opts.width;
    var height = opts.height;
    var viewX = opts.viewX;
    var viewY = opts.viewY;
    var pathSlice = opts.pathSlice;
    var toMoveInsideSlice = opts.toMoveInsideSlice;
    var strTransform = opts.strTransform;
    var hasTransition = opts.hasTransition;
    var handleSlicesExit = opts.handleSlicesExit;
    var makeUpdateSliceInterpolator = opts.makeUpdateSliceInterpolator;
    var makeUpdateTextInterpolator = opts.makeUpdateTextInterpolator;
    var prevEntry = opts.prevEntry;
    var refRect = {};

    var fullLayout = gd._fullLayout;
    var cd0 = cd[0];
    var trace = cd0.trace;

    var hasLeft = trace.textposition.indexOf('left') !== -1;
    var hasRight = trace.textposition.indexOf('right') !== -1;
    var hasBottom = trace.textposition.indexOf('bottom') !== -1;

    var noRoomForHeader = (!hasBottom && !trace.marker.pad.t) || (hasBottom && !trace.marker.pad.b);

    // N.B. slice data isn't the calcdata,
    // grab corresponding calcdata item in sliceData[i].data.data
    var allData = partition(entry, [width, height], {
        packing: trace.tiling.packing,
        squarifyratio: trace.tiling.squarifyratio,
        flipX: trace.tiling.flip.indexOf('x') > -1,
        flipY: trace.tiling.flip.indexOf('y') > -1,
        pad: {
            inner: trace.tiling.pad,
            top: trace.marker.pad.t,
            left: trace.marker.pad.l,
            right: trace.marker.pad.r,
            bottom: trace.marker.pad.b,
        }
    });

    var getRefRect = function() {
        if(!trace._clickedInfo) return refRect;
        return helpers.findChildPt(allData, trace._clickedInfo.id);
    };

    var sliceData = allData.descendants();

    // filter out slices that won't show up on graph
    sliceData = sliceData.filter(function(pt) { return pt.depth < trace._maxDepth; });

    slices = slices.data(sliceData, function(pt) { return helpers.getPtId(pt); });

    slices.enter().append('g')
        .classed('slice', true);

    handleSlicesExit(slices, upDown, refRect, [width, height], pathSlice);

    slices.order();

    // next coords of previous entry
    var nextOfPrevEntry = null;
    if(hasTransition && prevEntry) {
        var prevEntryId = helpers.getPtId(prevEntry);
        slices.each(function(pt) {
            if(nextOfPrevEntry === null && (helpers.getPtId(pt) === prevEntryId)) {
                nextOfPrevEntry = {
                    x0: pt.x0,
                    x1: pt.x1,
                    y0: pt.y0,
                    y1: pt.y1
                };
            }
        });
    }

    var updateSlices = slices;
    if(hasTransition) {
        updateSlices = updateSlices.transition().each('end', function() {
            // N.B. gd._transitioning is (still) *true* by the time
            // transition updates get here
            var sliceTop = d3.select(this);
            helpers.setSliceCursor(sliceTop, gd, {
                hideOnRoot: true,
                hideOnLeaves: false,
                isTransitioning: false
            });
        });
    }

    updateSlices.each(function(pt) {
        var isHeader = helpers.isHeader(pt, trace);

        pt._hoverX = viewX(pt.x1 - trace.marker.pad.r),
        pt._hoverY = hasBottom ?
                viewY(pt.y1 - trace.marker.pad.b / 2) :
                viewY(pt.y0 + trace.marker.pad.t / 2);

        var sliceTop = d3.select(this);

        var slicePath = Lib.ensureSingle(sliceTop, 'path', 'surface', function(s) {
            s.style('pointer-events', 'all');
        });

        if(hasTransition) {
            slicePath.transition().attrTween('d', function(pt2) {
                var interp = makeUpdateSliceInterpolator(pt2, upDown, getRefRect(), [width, height]);
                return function(t) { return pathSlice(interp(t)); };
            });
        } else {
            slicePath.attr('d', pathSlice);
        }

        sliceTop
            .call(attachFxHandlers, entry, gd, cd, {
                styleOne: styleOne,
                eventDataKeys: constants.eventDataKeys,
                transitionTime: constants.CLICK_TRANSITION_TIME,
                transitionEasing: constants.CLICK_TRANSITION_EASING
            })
            .call(helpers.setSliceCursor, gd, { isTransitioning: gd._transitioning });

        slicePath.call(styleOne, pt, trace, {
            hovered: false
        });

        var sliceTextGroup = Lib.ensureSingle(sliceTop, 'g', 'slicetext');
        var sliceText = Lib.ensureSingle(sliceTextGroup, 'text', '', function(s) {
            // prohibit tex interpretation until we can handle
            // tex and regular text together
            s.attr('data-notex', 1);
        });

        if(isHeader && noRoomForHeader) return;

        var tx = formatSliceLabel(pt, entry, trace, cd, fullLayout);

        sliceText.text(tx)
            .classed('slicetext', true)
            .attr('text-anchor', hasRight ? 'end' : (hasLeft || isHeader) ? 'start' : 'middle')
            .call(Drawing.font, helpers.determineTextFont(trace, pt, fullLayout.font))
            .call(svgTextUtils.convertToTspans, gd);

        pt.textBB = Drawing.bBox(sliceText.node());
        pt.transform = toMoveInsideSlice(
            pt.x0,
            pt.x1,
            pt.y0,
            pt.y1,
            pt.textBB,
            {
                isHeader: isHeader
            }
        );

        if(helpers.isOutsideText(trace, pt)) {
            // consider in/out diff font sizes
            pt.transform.targetY -= (
                helpers.getOutsideTextFontKey('size', trace, pt, fullLayout.font) -
                helpers.getInsideTextFontKey('size', trace, pt, fullLayout.font)
            );
        }

        if(hasTransition) {
            sliceText.transition().attrTween('transform', function(pt2) {
                var interp = makeUpdateTextInterpolator(pt2, upDown, getRefRect(), [width, height]);
                return function(t) { return strTransform(interp(t)); };
            });
        } else {
            sliceText.attr('transform', strTransform(pt));
        }
    });

    return nextOfPrevEntry;
};
