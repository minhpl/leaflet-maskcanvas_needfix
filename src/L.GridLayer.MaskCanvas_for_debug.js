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
    numPoints: 0,
    status: LOADED
};

const MAXRADIUSPOLY = 256;
const NUMPOLYGON = 10;
const VPOLY = 1;
const BPOLY = 2;
const HUGETILE_THREADSHOLD = 5000

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

    ready : false,

    needPersistents: 0,

    prev: undefined,

    tiles: new lru(40),
    hugeTiles: new lru(40),

    emptyTiles: new lru(4000),    
    canvases: new lru(90),

    // rtreeLCTilePoly: new lru(40),    
    BBGlobalLatlng: [-9999, -9999, -9999, -9999],
    initialize: function(options) {
        L.setOptions(this, options);
        var db = this.options.db;
        var self = this;
        if (db) {
            // db.destroy().then(function(){
            //   console.log("PouchDB destroyed");
            // }).catch(function(err){
            //   console.log(err);
            // });
            db.allDocs({
                include_docs: true,
                attachments: true
            }).then(function(result) {
                // handle result
                return Promise.all(result.rows.map(function(row) {
                    return db.remove(row.id, row.value.rev);
                })).then(function() {
                    ready = true;
                    console.log("Remove all temporary tiles");
                });

            }).catch(function(err) {
                console.log(err);
            });
        }
    },

    getId: function(coords) {
        return coords.z + "_" + coords.x + "_" + coords.y;
    },

    iscollides: function(coords) {
        var tileSize = this.options.tileSize;

        // console.log("coords---------------------",coords);

        // console.log("tileSize: ",tileSize);
        var nwPoint = coords.multiplyBy(tileSize);
        var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));
        var nw = this._map.unproject(nwPoint, coords.z);
        var se = this._map.unproject(sePoint, coords.z);
        var tileBB = L.latLngBounds([nw, se]);

        // console.log("tilebox: ",tileBB);

        var bb = this.BBGlobalLatlng;
        var southWest = L.latLng(bb[0], bb[1]),
            northEast = L.latLng(bb[2], bb[3]);
        var GBB = L.latLngBounds(southWest, northEast);

        // console.log("GBOX: ",GBB);
        return GBB.intersects(tileBB);
    },

    createTile: function(coords) {

        var id = coords.z + "_" + coords.x + "_" + coords.y;
        var savedTile = this.hugeTiles.get(id) || this.tiles.get(id);
        console.log("call create Tile ", id);

        var canvas = (savedTile && savedTile.canvas) ? savedTile.canvas : document.createElement('canvas');
        if (!canvas) canvas = document.createElement('canvas');
        canvas.width = canvas.height = this.options.tileSize;

        this._draw(canvas, coords);

        if (this.options.debug) {
            this._drawDebugInfo(canvas, coords);
        }

        if (savedTile) {
            savedTile.canvas = canvas;
        }
        return canvas;
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


    //dung roi
    getVertexAndBoundinLatLng: function(poly) {
        var map = this.options.map;
        var zoom = 12; //map.getZoom();
        console.log("zoom", zoom);

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

    //dung roi
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

            var lat = 20.9204 + Math.random() * (21.11269 - 20.9204);
            var lng = 105.59578 + Math.random() * (105.88451 - 105.59578);

            var posL = [lat, lng];

            var poly = makeVPolygon(10, 10); //tao hinh dang cua polygon            

            poly.posL = posL; //set vi tri cho polygon

            this.getVertexAndBoundinLatLng(poly);

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

    //dung roi
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


    setRadius: function(radius) {
        this.options.radius = radius;
        this.redraw();
    },


    _getMaxRadius: function(zoom) {
        return this._calcRadius(this._maxRadius, zoom);
    },

    _tilePoint: function(coords, pointCoordinate) {
        // start coords to tile 'space'
        var s = coords.multiplyBy(this.options.tileSize);

        // actual coords to tile 'space'
        var p = this._map.project(new L.LatLng(pointCoordinate[0], pointCoordinate[1]), coords.z);

        // point to draw
        var x = (p.x - s.x);
        x = (x < 0) ? (x - 0.5) >> 0 : (x + 0.5) >> 0; //Math.round
        var y = (p.y - s.y);
        y = (y < 0) ? (y - 0.5) >> 0 : (y + 0.5) >> 0; //Math.round
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


    _latLngToLayerPoint: function(latLng, zoom) {
        var point = this._map.project(latLng, zoom)._round();
        return point._subtract(this._map.getPixelOrigin());
    },



    _draw: function(canvas, coords) {
        // var valid = this.iscollides(coords);
        // if (!valid) return;
        // if (!this._rtree || !this._map) {
        //   return;
        // }
        var self = this;
        var id = coords.z + "_" + coords.x + "_" + coords.y;

        //draw all mark on lru element's canvas
        this.canvases.forEach(function(node, i) {
            var canvas = node.value;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(self.options.img_off, 0, 0);
            ctx.font = "18px Arial";
            ctx.strokeStyle = '#000';
            // ctx.strokeText(i,10,50);
        });

        //draw mark on all lru's remove
        this.canvases.set(id, canvas, function(removed, keyadd) {
            var canvas = removed.value;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(self.options.img_on, 0, 0);
            ctx.font = "18px Arial";
            ctx.strokeStyle = '#000';
            console.log("removed: ", removed.key);
            // ctx.strokeText(i,10,50);

        });

        if (!this._rtree || !this._map) {
            return;
        }

        var tileSize = this.options.tileSize;

        var nwPoint = coords.multiplyBy(tileSize);
        var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

        if (this.options.useAbsoluteRadius) {
            var centerPoint = nwPoint.add(new L.Point(tileSize >> 1, tileSize >> 1));
            this._latLng = this._map.unproject(centerPoint, coords.z);
        }

        // padding
        // console.log("max radius ",this._getMaxRadius(coords.z));
        var pad = new L.Point(0, 0);
        nwPoint = nwPoint.subtract(pad);
        sePoint = sePoint.add(pad);

        var bounds = new L.LatLngBounds(this._map.unproject(sePoint, coords.z), this._map.unproject(nwPoint, coords.z));

        var currentBounds = this._boundsToQuery(bounds);
        var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];
        var vpolyCoordinates = this._rtreePolygon.search(bb);

        vpolyCoordinates.sort(function(a, b) {
                return a[5] - b[5];
            })
            // var self = this;
            // var lcData = [];

        this._drawVPolys(canvas, coords, vpolyCoordinates);
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
        }
        ctx.drawImage(poly.canvas, topLeft[0], topLeft[1]);
    },


    _drawVPolys: function(canvas, coords, pointCoordinates) {

        var ctx = canvas.getContext('2d'),
            tilePoint;

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
