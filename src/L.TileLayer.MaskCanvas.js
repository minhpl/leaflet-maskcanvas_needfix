// const LOADED = 1;
// const LOADING = -1;
// const UNLOAD = 0;
// const EMPTY = {
//     empty: true,
//     needSave: false,
//     numPoints: 0,
//     status: LOADED
// };


const NUMPOLYGON = 100;
const NUMCELL = 100;
const HCELLARCSIZE = ((65 / 2) / 180) * Math.PI;
const NORTH = 3 * (Math.PI / 2);
const RED = "#FF0066";
const BLUE = "#6666FF";
const TILESIZE = 256;

L.TileLayer.MaskCanvas = L.TileLayer.Canvas.extend({

    options: {
        // db: new PouchDB('vmts'),
        radius: 5, // this is the default radius (specific radius values may be passed with the data)
        useAbsoluteRadius: false, // true: radius in meters, false: radius in pixels
        color: '#000',
        opacity: 0.5,
        noMask: false, // true results in normal (filled) circled, instead masked circles
        lineColor: undefined, // color of the circle outline if noMask is true
        debug: true,
        zIndex: 18, // if it is lower, then the layer is not in front
        img_on: undefined,
        img_off: undefined,
        map: undefined,
        useGlobalData: false,
        boundary: true,
    },

    ready: false,
    rtree_loaded: false,

    needPersistents: 0,

    prev: undefined,

    tiles: new lru(40),
    hugeTiles: new lru(40),

    rtree_cachedTile: rbush(32),

    emptyTiles: new lru(4000),
    canvases: new lru(100),

    // rtreeLCTilePoly: new lru(40),    
    BBAllPointLatlng: [-9999, -9999, -9999, -9999],


    cellRadius: 30,
    inputRadius: false,
    drawCell2D: true,
    drawCell3D: true,
    showCellName: true,
    cellNameRadius: 30,

    getId: function(coords) {
        return coords.z + "_" + coords.x + "_" + coords.y;
    },

    makeDataPoly: function(dataPoly) {
        var id = 0;
        if (!dataPoly) {
            var dPoly = [];
            var maxWith = 0.0025674919142666397;
            var maxHeight = 0.0274658203125;
            // var canvas = document.getElementById('myCanvas');
            // var ctx = canvas.getContext('2d');
            // ctx.fillStyle = 'rgba(20,250,200,0.1)';
            for (j = 0; j < NUMPOLYGON; j++) {
                // 20.9204, 105.59578
                // 21.11269, 105.88451

                // lat: 21.056267652104697, lng: 105.8020305633545

                // lat: 21.00952219788383, lng: 105.72898864746095

                // 21.15176, 105.65826
                // 20.76831, 105.25108
                var lat = 21.00952219788383 + Math.random() * (21.056267652104697 - 21.00952219788383);
                var lng = 105.72898864746095 + Math.random() * (105.8020305633545 - 105.72898864746095);

                var poly = makeVPolygon2(lat, lng, maxWith, maxHeight); //tao hinh dang cua polygon                        
                poly[0].c = 'rgba(0, 255, 0,1)';

                // this.getVertexAndBoundinLatLng(poly);
                var vertexsL = [];
                for (var i = 0; i < poly.length; i++) {
                    var vertex = poly[i];
                    var vertexL = L.latLng(vertex.x, vertex.y);
                    vertexsL.push(vertexL);
                }

                poly.vertexsL = vertexsL;
                poly.lBounds = L.latLngBounds(vertexsL);

                var center = poly.lBounds.getCenter();
                poly.posL = [center.lat, center.lng];

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
        } else {
            var dPoly = [];
            for (var i = 0; i < dataPoly.length; i++) {
                var poly = dataPoly[i];
                var vertexsL = [];
                for (var index = 0; index < poly.length; index++) {
                    var vertex = poly[index];
                    var vertexL = L.latLng(vertex.x, vertex.y);
                    vertexsL.push(vertexL);
                }
                poly.vertexsL = vertexsL;
                poly.lBounds = L.latLngBounds(vertexsL);
                // console.log(poly);
                var center = poly.lBounds.getCenter();
                poly.posL = [center.lat, center.lng];
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
        }
    },

    makeDataCell: function(dataCell) {
        if (!dataCell) {
            var sectors = [];

            for (var i = 0; i < NUMCELL; i++) {
                var lat = 20.76831 + Math.random() * (21.15176 - 20.76831);
                var lng = 105.25108 + Math.random() * (105.65826 - 105.25108);

                var rand = Math.random();

                var item = {};
                item.lat = lat;
                item.lng = lng;
                item.startingAngle = 360 * rand;
                item.arcSize = 65;

                var colorcode = (rand * 2) >> 0;
                item.color = colorcode == 0 ? RED : BLUE;
                // console.log(item);
                var sector = [lat, lng, lat, lng, item, i];
                sectors.push(sector);
            }
            return sectors;
        } else {

            var sectors = [];
            console.log(dataCell.length);
            for (var i = 0; i < dataCell.length; i++) {
                var cell = dataCell[i];

                var azimuth = cell.azimuth;
                var azimuthR = this.degreeToRadian(azimuth);

                cell.biRadian = NORTH + azimuth;
                cell.startRadian = cell.biRadian - HCELLARCSIZE;
                cell.endRadian = cell.biRadian + HCELLARCSIZE;

                var sector = [cell.lat, cell.lng, cell.lat, cell.lng, cell, i];

                sectors.push(sector);
            }

            return sectors;
        }
    },

    setDataPoly: function(dataPoly) {
        var self = this;
        // this.bounds = new L.LatLngBounds(dataset);

        // this._rtree = new rbush(32);
        // this.rtree_loaded = false;

        // this.makeRtree(self.rtree_loaded).then(function(res) {
        //     // console.log(res);
        //     if (self._map) {
        //         self.redraw();
        //     }
        //     // console.log(self.rtree_loaded);
        // }).catch(function(err) {
        //     console.log(err);
        // })


        this._rtreePolygon = new rbush(32);
        if (dataPoly)
            this._rtreePolygon.load(this.makeDataPoly(dataPoly));
        else this._rtreePolygon.load(this.makeDataPoly());

        this._maxRadius = this.options.radius;
    },

    setDataCell: function(dataCell) {
        if (dataCell) {
            this._rtreeCell = new rbush(32);
            this._rtreeCell.load(this.makeDataCell(dataCell));
        } else {
            this._rtreeCell = new rbush(32);
            this._rtreeCell.load(this.makeDataCell());
        }
        this._maxRadius = this.options.radius;
    },

    initialize: function(options, data) {
        var self = this;
        L.Util.setOptions(this, options);

        this.drawTile = function(tile, tilePoint, zoom) {
            var ctx = {
                canvas: tile,
                tilePoint: tilePoint,
                zoom: zoom
            };

            var canvas = ctx.canvas;
            var coords = ctx.tilePoint;
            coords.z = zoom;

            if (self.options.debug) {
                self._drawDebugInfo(canvas, coords);
            }

            this._draw(canvas, coords);
        };
    },


    _drawDebugInfo: function(canvas, coords) {
        var tileSize = this.options.tileSize;
        var ctx = canvas.getContext('2d');

        // ctx.globalCompositeOperation = 'xor';
        // canvas2d.globalCompositeOperation = "lighter";

        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
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

    setData: function(dataset) {
        var self = this;


        this.bounds = new L.LatLngBounds(dataset);

        this._quad = new QuadTree(this._boundsToQuery(this.bounds), false, 6, 6);

        var first = dataset[0];
        var xc = 1,
            yc = 0;
        if (first instanceof L.LatLng) {
            xc = "lng";
            yc = "lat";
        }

        dataset.forEach(function(d) {
            self._quad.insert({
                x: d[xc], //lng
                y: d[yc] //lat
            });
        });

        if (this._map) {
            this.redraw();
        }
    },

    setRadius: function(radius) {
        this.options.radius = radius;
        this.redraw();
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

    _tilePoint: function(coords, pointCoordinate) {
        // start coords to tile 'space'

        // console.log(pointCoordinate);

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

    _drawPoints: function(ctx, coordinates) {
        var c = ctx.canvas,
            g = c.getContext('2d'),
            self = this,
            p,
            tileSize = this.options.tileSize;
        g.fillStyle = this.options.color;

        if (this.options.lineColor) {
            g.strokeStyle = this.options.lineColor;
            g.lineWidth = this.options.lineWidth || 1;
        }
        g.globalCompositeOperation = 'source-over';
        if (!this.options.noMask) {
            g.fillRect(0, 0, tileSize, tileSize);
            g.globalCompositeOperation = 'destination-out';
        }
        coordinates.forEach(function(coords) {
            p = self._tilePoint(ctx, coords);
            g.beginPath();
            g.arc(p[0], p[1], self._getRadius(), 0, Math.PI * 2);
            g.fill();
            if (self.options.lineColor) {
                g.stroke();
            }
        });
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

    _getLatRadius: function() {
        return (this.options.radius / 40075017) * 360;
    },

    _getLngRadius: function() {
        return this._getLatRadius() / Math.cos(L.LatLng.DEG_TO_RAD * this._latlng.lat);
    },

    // call to update the radius
    projectLatlngs: function() {
        var lngRadius = this._getLngRadius(),
            latlng2 = new L.LatLng(this._latlng.lat, this._latlng.lng - lngRadius, true),
            point2 = this._map.latLngToLayerPoint(latlng2),
            point = this._map.latLngToLayerPoint(this._latlng);
        this._radius = Math.max(Math.round(point.x - point2.x), 1);
    },

    // the radius of a circle can be either absolute in pixels or in meters
    _getRadius: function() {
        if (this.options.useAbsoluteRadius) {
            return this._radius;
        } else {
            return this.options.radius;
        }
    },

    _draw: function(canvas, coords) {
        // var valid = this.iscollides(coords);
        // if (!valid) return;          
        if ((!this._rtreePolygon && !this._rtreeCell) || !this._map) {
            return;
        }

        var id = this.getId(coords);
        this.canvases.set(id, canvas);

        var self = this;

        var getBB = function(coords, padSize) {
            var tileSize = self.options.tileSize;
            var nwPoint = coords.multiplyBy(tileSize);
            var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

            if (self.options.useAbsoluteRadius) {
                var centerPoint = nwPoint.add(new L.Point(tileSize / 2, tileSize / 2));
                self._latLng = self._map.unproject(centerPoint, coords.z);
            }

            // padding
            var pad;
            if (!padSize)
                pad = new L.Point(self._getMaxRadius(coords.z), self._getMaxRadius(coords.z));
            else
                pad = new L.Point(padSize, padSize);

            // console.log(pad);
            nwPoint = nwPoint.subtract(pad);
            sePoint = sePoint.add(pad);

            var bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z),
                self._map.unproject(nwPoint, coords.z));

            var currentBounds = self._boundsToQuery(bounds);
            var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];

            return bb;
        }

        var queryPolys = function(coords, self) {
            if (!self._rtreePolygon)
                return [];

            var tileSize = self.options.tileSize;

            var nwPoint = coords.multiplyBy(tileSize);
            var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

            if (self.options.useAbsoluteRadius) {
                var centerPoint = nwPoint.add(new L.Point(tileSize >> 1, tileSize >> 1));
                this._latLng = this._map.unproject(centerPoint, coords.z);
            }

            var bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z), self._map.unproject(nwPoint, coords.z));

            var currentBounds = self._boundsToQuery(bounds);
            var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];
            var vpolyCoordinates = self._rtreePolygon.search(bb);

            vpolyCoordinates.sort(function(a, b) {
                return a[5] - b[5];
            })
            return vpolyCoordinates;
        }

        var vpolyCoordinates = queryPolys(coords, this);
        this._drawVPolys(canvas, coords, vpolyCoordinates);

        if (!self.inputRadius)
            self.getRadiusFn(coords.z);

        var queryCells = function(coords) {
            if (!self._rtreeCell)
                return [];
            var bb = getBB(coords, self.cellRadius);

            var cellCoordinates = self._rtreeCell.search(bb);

            // if (cellCoordinates.length > 0)
            // console.log("---------------------??", cellCoordinates);

            cellCoordinates.sort(function(a, b) {
                return a[5] - b[5];
            })
            return cellCoordinates;
        }

        var cells = queryCells(coords);
        this.drawCells(canvas, coords, cells);

        // this.drawCellName(canvas, coords, cells);
    },


    getRadiusFn: function(zoom) {
        switch (zoom) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
                this.cellRadius = 4;
                return 4;
            case 6:
            case 7:
            case 8:
            case 9:
                this.cellRadius = 6;
                return 6;
            case 10:
            case 11:
            case 12:
                this.cellRadius = 8;
                return 8;
            case 13:
                this.cellRadius = 12;
                return 12;
            case 14:
                this.cellRadius = 16;
                return 16;
            case 15:
                this.cellRadius = 20;
                return 20;
            case 16:
                this.cellRadius = 24;
                return 24;
            case 17:
                this.cellRadius = 30;
                return 30;
            case 18:
                this.cellRadius = 36;
                return 36;
            default:
                this.cellRadius = 38;
                return 38;
        }
    },

    getCanvas: function(vpoly, coords, fillColor) {
        var boundsL = vpoly.lBounds;
        var nw = boundsL.getNorthWest();
        topLeft = this._tilePoint(coords, [nw.lat, nw.lng]);

        var se = boundsL.getSouthEast();
        var bottomRight = this._tilePoint(coords, [se.lat, se.lng]);
        var width = bottomRight[0] - topLeft[0];
        var height = bottomRight[1] - topLeft[1];

        var canvas = document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;

        var subctx = canvas.getContext('2d');
        subctx.fillStyle = fillColor;

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


        subctx.closePath();
        subctx.fill();
        if (this.options.boundary) {
            subctx.strokeStyle = "black";
            subctx.stroke();
        }
        vpoly.size = [width, height];

        return canvas;
    },

    drawVPoly: function(poly, ctx, coords) {

        var id = this.getId(coords);
        // console.log(id);

        var boundsL = poly.lBounds;
        var nw = boundsL.getNorthWest();
        topLeft = this._tilePoint(coords, [nw.lat, nw.lng]);

        if (poly.zoom != coords.z) {
            poly.zoom = coords.z;

            var canvas = this.getCanvas(poly, coords, poly[0].c);

            poly.canvas = canvas;
            poly.canvas2 = this.getCanvas(poly, coords, "rgba(250, 0, 0,1)");
            // poly.size = [width, height];
        }

        if (poly.canvas.width != 0 && poly.canvas.height != 0) {
            ctx.drawImage(poly.canvas, topLeft[0], topLeft[1]);
        }
    },

    _drawVPolys: function(canvas, coords, pointCoordinates) {
        var ctx = canvas.getContext('2d');
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
    },

    degreeToRadian: function(degree) {
        return (degree * Math.PI) / 180;
    },

    drawCell: function(ctx, pts, cell) {
        var x = pts[0];
        var y = pts[1];

        var color = cell.cell_type == 2 ? RED : BLUE;

        if (this.drawCell2D == false && cell.cell_type == 2)
            return;
        if (this.drawCell3D == false && cell.cell_type == 3)
            return;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, this.cellRadius, cell.startRadian, cell.endRadian, false);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();

        if (this.showCellName) {
            // console.log(cell);
            var xt = this.cellRadius * Math.cos(cell.biRadian);
            var yt = this.cellRadius * Math.sin(cell.biRadian);

            ctx.fillStyle = 'black';
            ctx.fillText(cell.cell_code, xt + x, yt + y);
        }
    },

    drawCells: function(canvas, coords, cells) {
        var ctx = canvas.getContext('2d');
        ctx.font = '12pt Calibri'; // Calibri';
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i][4];
            var pos = this._tilePoint(coords, [cell.lat, cell.lng]);
            // console.log(coords.z, "-----------");
            this.drawCell(ctx, pos, cell);
        }
    },

});

L.TileLayer.maskCanvas = function(options) {
    var mc = new L.TileLayer.MaskCanvas(options);
    leafletVersion = parseInt(L.version.match(/\d{1,}\.(\d{1,})\.\d{1,}/)[1], 10);
    if (leafletVersion < 7) mc._createTile = mc._oldCreateTile;
    return mc;
};
