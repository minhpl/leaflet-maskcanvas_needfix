/**
 * This L.GridLayer.MaskCanvas plugin is for Leaflet 1.0
 * For Leaflet 0.7.x, please use L.TileLayer.MaskCanvas
 */

const LOADED = 1;
const LOADING = -1;
const UNLOAD = 0;
const EMPTY = {
    empty: true,
    needSave: false,
    status: LOADED
};

const MAXRADIUSPOLY = 256;
const NUMPOLYGON = 20;
const VPOLY = 1;
const BPOLY = 2;

L.GridLayer.MaskCanvas = L.GridLayer.extend({
    options: {
        db: new PouchDB('vmts'),
        radius: 5, // this is the default radius (specific radius values may be passed with the data)
        useAbsoluteRadius: false, // true: radius in meters, false: radius in pixels
        color: '#000',
        opacity: 0.5,
        noMask: false, // true results in normal (filled) circled, instead masked circles
        lineColor: undefined, // color of the circle outline if noMask is true
        debug: false,
        zIndex: 18, // if it is lower, then the layer is not in front
        img_on: undefined,
        img_off: undefined,
        map: undefined
    },

    needPersistents: 0,

    prev: undefined,

    tiles: new lru(100),
    emptyTiles: new lru(4000),
    rtreeLCTilePoly: new lru(40),

    BBGlobalLatlng: [-9999, -9999, -9999, -9999],

    initialize: function(options) {
        L.setOptions(this, options);
        var db = this.options.db;
        var self = this;
        if (db) {

            db.allDocs({
                include_docs: true,
                attachments: true
            }).then(function(result) {
                // handle result
                return Promise.all(result.rows.map(function(row) {
                    return db.remove(row.id, row.value.rev);
                })).then(function() {
                    console.log("Remove all temporary tiles");
                });

            }).catch(function(err) {
                console.log(err);
            });
        }
    },

    createTile: function(coords) {
        var id = coords.z + "_" + coords.x + "_" + coords.y;
        var savedTile = this.tiles.get(id);

        var tile = (savedTile && savedTile.canvas) ? savedTile.canvas : document.createElement('canvas');
        if (!tile) tile = document.createElement('canvas');
        tile.width = tile.height = this.options.tileSize;

        if (this.options.debug) {
            this._drawDebugInfo(tile, coords);
        }

        this._draw(tile, coords);

        if (savedTile) {
            savedTile.canvas = tile;
        }
        return tile;
    },

    _drawDebugInfo: function(canvas, coords) {
        var tileSize = this.options.tileSize;
        var ctx = canvas.getContext('2d');

        // ctx.globalCompositeOperation = 'xor';
        // canvas2d.globalCompositeOperation = "lighter";

        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, tileSize, tileSize);

        ctx.strokeStyle = '#000';
        ctx.strokeText('x: ' + coords.x + ', y: ' + coords.y + ', zoom: ' + coords.z, 20, 20);

        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(tileSize, 0);
        ctx.lineTo(tileSize, tileSize);
        ctx.lineTo(0, tileSize);
        ctx.closePath();
        ctx.stroke();
    },

    getVertexLatAndBoundinLatLng: function(poly) {
        var map = this.options.map;
        var zoom = 13; //map.getZoom();

        var tempVertexsP = [];
        for (var i = 0; i < poly.length; i++) {
            var p = poly[i];
            tempVertexsP.push(L.point(p.x, p.y));
        }

        var bound = L.bounds(tempVertexsP);
        var tempCenterP = bound.getCenter();

        var centerL = L.latLng(poly.posL[0], poly.posL[1]);
        var centerP = map.project(centerL, zoom);

        var distance = centerP.subtract(tempCenterP);

        var vertexsL = [];
        for (var i = 0; i < poly.length; i++) {
            var vertexP = tempVertexsP[i].add(distance);
            var vertexL = map.unproject(vertexP, zoom);
            vertexsL.push(vertexL);
        }

        poly.vertexsL = vertexsL;
        poly.lBounds = L.latLngBounds(vertexsL);
    },


    drawVPoly: function(poly, ctx, i) {
        var v0 = poly[0];

        ctx.translate(60, 60);

        ctx.moveTo(v0.x, v0.y);

        for (var i = 1; i < poly.length; i++) {
            var vi = poly[i];
            ctx.lineTo(vi.x, vi.y);
        }

        ctx.strokeStyle = "green";
        ctx.lineWidth = "2";
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    },

    makeDataPoly: function() {
        var dlength = dataset.length;
        var interval = (dlength / NUMPOLYGON) >> 0;
        console.log("interval ", interval);
        var dPoly = [];
        var id = 0;

        // var canvas = document.getElementById('myCanvas');
        // var ctx = canvas.getContext('2d');
        // ctx.fillStyle = 'rgba(20,250,200,0.1)';

        for (var i = 0, j = 0; i < dlength && j < NUMPOLYGON; i += interval, j++) {

            // 20.9204, 105.59578
            // 21.11269, 105.88451

            var lat = 20.9204+Math.random()*(21.11269-20.9204);
            var lng = 105.59578+Math.random()*(105.88451-105.59578);

            var posL = [lat,lng];
            console.log(posL);

            var poly = makeVPolygon(10, 10); //tao hinh dang cua polygon            

            poly.posL = posL; //set vi tri cho polygon

            this.getVertexLatAndBoundinLatLng(poly);

            poly.in = function(currentlatLng) {
                var x = currentlatLng.lat,
                    y = currentlatLng.lng;

                var vertexsL = this.vertexsL;
                var inside = false;
                for (var i = 0, j = vertexsL.length - 1; i < vertexsL.length; j = i++) {
                    var xi = vertexsL[i].lat,
                        yi = vertexsL[i].lng;
                    var xj = vertexsL[j].lat,
                        yj = vertexsL[j].lng;

                    var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                    if (intersect) inside = !inside;
                }

                return inside;
            }

            lBounds = poly.lBounds;
            var a = [lBounds.getSouth(), lBounds.getWest(), lBounds.getNorth(), lBounds.getEast(), poly, id++];
            dPoly.push(a);
        }

        return dPoly;
    },

    setData: function(dataset) {
        var self = this;
        this.bounds = new L.LatLngBounds(dataset);

        var minXLatLng = 10000,
            minYLatLng = 10000,
            maxXLatLng = -1000,
            maxYLatLng = -1000;

        this._rtree = new rbush(32);
        var data = [];
        for (var i = 0; i < dataset.length; ++i) {
            var item = dataset[i];
            var x = item[0];
            var y = item[1];
            data.push([x, y, x, y, item, i]);

            if (x < minXLatLng) minXLatLng = x;
            if (y < minYLatLng) minYLatLng = y;
            if (x > maxXLatLng) maxXLatLng = x;
            if (y > maxYLatLng) maxYLatLng = y;
        }

        this.BBGlobalLatlng = [minXLatLng, minYLatLng, maxXLatLng, maxYLatLng];

        this._rtree.load(data);

        this._rtreePolygon = new rbush(32);
        this._rtreePolygon.load(this.makeDataPoly());


        this._maxRadius = this.options.radius;

        if (this._map) {
            this.redraw();
        }
    },

    /**
     * Set default radius value.
     *
     * @param {number} radius
     */
    setRadius: function(radius) {
        this.options.radius = radius;
        this.redraw();
    },

    /**
     * Returns the biggest radius value of all data points.
     *
     * @param {number} zoom Is required for projecting.
     * @returns {number}
     * @private
     */
    _getMaxRadius: function(zoom) {
        return this._calcRadius(this._maxRadius, zoom);
    },

    /**
     * @param {L.Point} coords
     * @param {{x: number, y: number, r: number}} pointCoordinate
     * @returns {[number, number, number]}
     * @private
     */
    _tilePoint: function(coords, pointCoordinate) {
        // start coords to tile 'space'
        var s = coords.multiplyBy(this.options.tileSize);

        // actual coords to tile 'space'
        var p = this._map.project(new L.LatLng(pointCoordinate[0], pointCoordinate[1]), coords.z);

        // point to draw
        var x = Math.round(p.x - s.x);
        // x = (x < 0) ? (x-0.5) >> 0 : (x+0.5) >>0;//Math.round
        var y = Math.round(p.y - s.y);
        // y = (y < 0) ? (y-0.5) >> 0 : (y+0.5) >>0;//Math.round
        var r = this._calcRadius(pointCoordinate.r || this.options.radius, coords.z);
        return [x, y, r];
    },

    _boundsToQuery: function(bounds) {
        if (bounds.getSouthWest() == undefined) {
            return {
                x: 0,
                y: 0,
                width: 0.1,
                height: 0.1
            };
        } // for empty data sets
        return {
            x: bounds.getSouthWest().lng,
            y: bounds.getSouthWest().lat,
            width: bounds.getNorthEast().lng - bounds.getSouthWest().lng,
            height: bounds.getNorthEast().lat - bounds.getSouthWest().lat
        };
    },

    /**
     * The radius of a circle can be either absolute in pixels or in meters.
     *
     * @param {number} radius Pass either custom point radius, or default radius.
     * @param {number} zoom Zoom level
     * @returns {number} Projected radius (stays the same distance in meters across zoom levels).
     * @private
     */
    _calcRadius: function(radius, zoom) {
        var projectedRadius;

        if (this.options.useAbsoluteRadius) {
            var latRadius = (radius / 40075017) * 360,
                lngRadius = latRadius / Math.cos(Math.PI / 180 * this._latLng.lat),
                latLng2 = new L.LatLng(this._latLng.lat, this._latLng.lng - lngRadius, true),
                point2 = this._latLngToLayerPoint(latLng2, zoom),
                point = this._latLngToLayerPoint(this._latLng, zoom);

            projectedRadius = Math.max(Math.round(point.x - point2.x), 1);
        } else {
            projectedRadius = radius;
        }

        return projectedRadius;
    },

    /**
     * This is used instead of this._map.latLngToLayerPoint
     * in order to use custom zoom value.
     *
     * @param {L.LatLng} latLng
     * @param {number} zoom
     * @returns {L.Point}
     * @private
     */
    _latLngToLayerPoint: function(latLng, zoom) {
        var point = this._map.project(latLng, zoom)._round();
        return point._subtract(this._map.getPixelOrigin());
    },

    /**
     * @param {HTMLCanvasElement|HTMLElement} canvas
     * @param {L.Point} coords
     * @private
     */

    getId: function(coords) {
        return coords.z + "_" + coords.x + "_" + coords.y;
    },



    _draw: function(canvas, coords) {
        var id = coords.z + "_" + coords.x + "_" + coords.y;

        if (!this._rtree || !this._map) {
            return;
        }

        var tileSize = this.options.tileSize;

        var nwPoint = coords.multiplyBy(tileSize);
        var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));
        var pad, bb, bounds, currentBounds;

        if (this.options.useAbsoluteRadius) {
            var centerPoint = nwPoint.add(new L.Point(tileSize / 2, tileSize / 2));
            this._latLng = this._map.unproject(centerPoint, coords.z);
        }

        var pad = new L.Point(this._getMaxRadius(coords.z), this._getMaxRadius(coords.z));
        nwPoint = nwPoint.subtract(pad);
        sePoint = sePoint.add(pad);

        var bounds = new L.LatLngBounds(this._map.unproject(sePoint, coords.z),
            this._map.unproject(nwPoint, coords.z));

        var currentBounds = this._boundsToQuery(bounds);
        var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];
        // console.log(bb);
        var pointCoordinates = this._rtree.search(bb);
        pointCoordinates.sort(function(a, b) {
            return a[5] - b[5];
        })

        this._drawPoints(canvas, coords, pointCoordinates)


        pad = new L.Point(0, 0);
        nwPoint = nwPoint.subtract(pad);
        sePoint = sePoint.add(pad);

        bounds = new L.LatLngBounds(this._map.unproject(sePoint, coords.z), this._map.unproject(nwPoint, coords.z));

        currentBounds = this._boundsToQuery(bounds);
        bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];
        // console.log(id,bb);

        var vpolyCoordinates = this._rtreePolygon.search(bb);
        vpolyCoordinates.sort(function(a, b) {
            return a[5] - b[5];
        })


        tile = {
            _id: id,
            data: pointCoordinates,
            dataPoly: vpolyCoordinates,
            // bb: bb,            
        }
        tile.canvas = canvas;

        this.tiles.set(id, tile);
        this._drawVPolys(canvas, coords, vpolyCoordinates);
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {L.Point} coords
     * @param {[{x: number, y: number, r: number}]} pointCoordinates
     * @private
     */
    _drawPoints: function(canvas, coords, pointCoordinates, sorted) {

        if (!sorted) pointCoordinates.sort(function(a, b) {
            return a[5] - b[5];
        });

        var ctx = canvas.getContext('2d'),
            tilePoint;
        ctx.fillStyle = this.options.color;

        if (this.options.lineColor) {
            ctx.strokeStyle = this.options.lineColor;
            ctx.lineWidth = this.options.lineWidth || 1;
        }

        if (pointCoordinates) {
            // var w = ((this.options.radius+ 0.5) >> 1) | 0;
            // var h = ((this.options.radius+0.5) >> 1) | 0;
            var w = this.options.radius >> 1;
            var h = this.options.radius >> 1;
            for (var index = 0; index < pointCoordinates.length; ++index) {
                tilePoint = this._tilePoint(coords, pointCoordinates[index]);
                // console.log(tilePoint[0],tilePoint[1]);
                var lx = tilePoint[0] - w;
                var ly = tilePoint[1] - h;
                lx = (lx < 0) ? (lx - 0.5) >> 0 : (lx + 0.5) >> 0;
                ly = (ly < 0) ? (ly - 0.5) >> 0 : (ly + 0.5) >> 0;
                // console.log(lx,ly);
                ctx.drawImage(this.options.img_on, lx, ly);
            }
        }
    },

    drawLinhTinh: function(canvas, coords, vpolyCoordinates) {
        var ctx = canvas.getContext('2d');
        ctx.drawImage(this.options.img_on, 0, 0);
    },

    getCanvas: function(vpoly, coords, color) {
        var boundsL = vpoly.lBounds;
        var nw = boundsL.getNorthWest();
        topLeft = this._tilePoint(coords, [nw.lat, nw.lng]);

        var canvas = document.createElement('canvas');
        var se = boundsL.getSouthEast();
        var bottomRight = this._tilePoint(coords, [se.lat, se.lng]);
        var width = bottomRight[0] - topLeft[0];
        var height = bottomRight[1] - topLeft[1];

        canvas.width = width;
        canvas.height = height;

        var subctx = canvas.getContext('2d');
        subctx.fillStyle = color;

        subctx.translate(-topLeft[0], -topLeft[1]);

        var vertexsL = vpoly.vertexsL;
        var v0 = vertexsL[0];
        var p0 = this._tilePoint(coords, [v0.lat, v0.lng]);

        subctx.moveTo(p0[0], p0[1]);

        for (var i = 1; i < vertexsL.length; i++) {
            var vi = vertexsL[i];
            var pi = this._tilePoint(coords, [vi.lat, vi.lng]);
            subctx.lineTo(pi[0], pi[1]);
        }

        subctx.strokeStyle = "black";
        subctx.closePath();
        subctx.fill();
        subctx.stroke();

        vpoly.size = [width, height];

        return canvas;
    },

    drawVPoly: function(poly, ctx, coords) {

        var id = this.getId(coords);

        var boundsL = poly.lBounds;
        var nw = boundsL.getNorthWest();
        topLeft = this._tilePoint(coords, [nw.lat, nw.lng]);

        if (poly.zoom != coords.z) {
            poly.zoom = coords.z;

            var canvas = this.getCanvas(poly, coords, "rgba(20,240,20,1)");

            poly.canvas = canvas;
            poly.canvas2 = this.getCanvas(poly, coords, "rgba(20,20,240,1)");
            // poly.size = [width, height];
        }

        ctx.drawImage(poly.canvas, topLeft[0], topLeft[1]);
    },


    _drawVPolys: function(canvas, coords, pointCoordinates) {

        var ctx = canvas.getContext('2d'),
            tilePoint;

        // ctx.globalCompositeOperation = 'lighter';

        if (this.options.lineColor) {
            ctx.strokeStyle = this.options.lineColor;
            ctx.lineWidth = this.options.lineWidth || 1;
        }

        var self = this;


        if (pointCoordinates) {
            for (var index = 0; index < pointCoordinates.length; ++index) {
                var polyInfo = pointCoordinates[index];
                var poly = polyInfo[4];
                this.drawVPoly(poly, ctx, coords);
            }
        }
    }

});

L.TileLayer.maskCanvas = function(options) {
    return new L.GridLayer.MaskCanvas(options);
};
