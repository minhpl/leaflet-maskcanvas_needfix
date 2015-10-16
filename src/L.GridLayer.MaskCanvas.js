/**
 * This L.GridLayer.MaskCanvas plugin is for Leaflet 1.0
 * For Leaflet 0.7.x, please use L.TileLayer.MaskCanvas
 */

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
const CELLTYPE2G = 2;
const CELLTYPE3G = 3;


console.log("leaflet version: ", L.version);

var version = L.version;
var tempLayer;
if (version[0] == 0) {
    tempLayer = L.TileLayer.Canvas;
} else {
    tempLayer = L.GridLayer;
}


L.TileLayer.MaskCanvas = tempLayer.extend({
    options: {
        // db: new PouchDB('vmts'),
        radius: 5, // this is the default radius (specific radius values may be passed with the data)
        useAbsoluteRadius: true, // true: radius in meters, false: radius in pixels
        color: '#000',
        opacity: 0.5,
        noMask: false, // true results in normal (filled) circled, instead masked circles
        lineColor: undefined, // color of the circle outline if noMask is true
        debug: false,
        zIndex: 18, // if it is lower, then the layer is not in front
        img_on: undefined,
        img_off: undefined,
        map: undefined,
        useGlobalData: false,
        boundary: true,
        _cellRadius: 30,
        hover_poly_color: 'rgba(200,0,0,1)',
        hover_cell_color: 'rgba(200,220,220,1)',
        bright_cell_color: 'rgba(255, 102, 204,1)',
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


    _cellRadius: undefined, //pixel    
    cellRadius: 50, //pixel   
    // inputRadius: false,
    drawCell2G: true,
    drawCell3G: true,
    showCellName: false,
    cellNameRadius: false,

    /**
     * [updateCachedTile description]
     * @param  {[type]} coords   [description]
     * @param  {[type]} numPoint [description]
     * @return {[type]}          [description]
     */

    // getRadiusFn: function(zoom) {
    //     switch (zoom) {
    //         case 1:
    //         case 2:
    //         case 3:
    //         case 4:
    //         case 5:
    //             this._cellRadius = 4;
    //             return 4;
    //         case 6:
    //         case 7:
    //         case 8:
    //         case 9:
    //             this._cellRadius = 6;
    //             return 6;
    //         case 10:
    //         case 11:
    //         case 12:
    //             this._cellRadius = 8;
    //             return 8;
    //         case 13:
    //             this._cellRadius = 12;
    //             return 12;
    //         case 14:
    //             this._cellRadius = 16;
    //             return 16;
    //         case 15:
    //             this._cellRadius = 20;
    //             return 20;
    //         case 16:
    //             this._cellRadius = 24;
    //             return 24;
    //         case 17:
    //             this._cellRadius = 30;
    //             return 30;
    //         case 18:
    //             this._cellRadius = 36;
    //             return 36;
    //         default:
    //             this._cellRadius = 38;
    //             return 38;
    //     }
    // },

    initialize: function(options) {
        L.Util.setOptions(this, options);

        var _cellRadius = this.options._cellRadius;
        var db = this.options.db;

        var self = this;
        if (db) {

            var refreshDB = function(self) {
                db.destroy().then(function(response) {
                    self.options.db = new PouchDB('vmts');
                    console.log("Refresh database");
                    self.ready = true;
                }).catch(function(err) {
                    console.log(err);
                })
            }

            refreshDB(this);
            // db.allDocs({
            //     include_docs: true,
            //     attachments: true
            // }).then(function(result) {
            //     // handle result
            //     return Promise.all(result.rows.map(function(row) {
            //         return db.remove(row.id, row.value.rev);
            //     })).then(function() {
            //         self.ready = true;
            //         console.log("Remove all temporary tiles");
            //     });

            // }).catch(function(err) {
            //     console.log(err);
            // });
        }

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

    // globalData: function() {
    //     this.options.useGlobalData = true;
    // },

    // localData: function() {
    //     this.options.useGlobalData = false;
    // },

    lastRecentInfo: {
        imgCropped: undefined,
        polyID: undefined,
        poly: undefined,
    },

    currentInfo: {
        isInsidePoly: undefined,
    },

    timeoutID: undefined,

    determineCell: function(latlng) {

        // latlng = [20.98359,105.88806]
        var currentLatLng = L.latLng([latlng[0], latlng[1]]);

        var self = this;
        var map = this.options.map;
        var zoom = map.getZoom();

        var currentPoint = map.project(currentLatLng, zoom);
        var x = (currentPoint.x / TILESIZE) >> 0;
        var y = (currentPoint.y / TILESIZE) >> 0;
        var coords = L.point(x, y);
        coords.z = zoom;


        var pad = L.point(self._cellRadius, self._cellRadius);
        var tlPts = currentPoint.subtract(pad);
        var brPts = currentPoint.add(pad);
        var nw = map.unproject(tlPts, zoom);
        var se = map.unproject(brPts, zoom);
        var bound = [se.lat, nw.lng, nw.lat, se.lng];

        function getIntersectCell(bound) {
            if (!self._rtreeCell)
                return [];

            var cells = self._rtreeCell.search(bound);

            var result = [];
            var id = -1,
                topCell = undefined;

            function isInsideSector(point, center, radius, angle1, angle2) {
                function areClockwise(center, radius, angle, point2) {
                    var point1 = {
                        x: (center.x + radius) * Math.cos(angle),
                        y: (center.y + radius) * Math.sin(angle)
                    };
                    return -point1.x * point2.y + point1.y * point2.x > 0;
                }

                var relPoint = {
                    x: point.x - center.x,
                    y: point.y - center.y
                };

                return !areClockwise(center, radius, angle1, relPoint) &&
                    areClockwise(center, radius, angle2, relPoint) &&
                    (relPoint.x * relPoint.x + relPoint.y * relPoint.y <= radius * radius);
            }

            if (cells.length > 0) {
                for (var i = 0; i < cells.length; i++) {
                    var r = cells[i];
                    var cell = r[4];
                    var center = map.project(L.latLng(cell.lat, cell.lng));
                    if (isInsideSector(currentPoint, center, self._cellRadius, cell.startRadian, cell.endRadian)) {
                        result.push(cell);
                        var a = r[5];
                        if (id < a) {
                            topCell = cell;
                            id = a;
                        }
                    }
                }

                result.topCell = topCell;
                result.topCellID = id;
                return result;
            }

            return [];
        }

        var cells = getIntersectCell(bound);
        var cell = cells.topCell;

        if (cell) {

            if (!this.lastRecentInfo.cell || (this.lastRecentInfo.cell && (cell.cell_code != this.lastRecentInfo.cell.cell_code))) {

                var radius = self._cellRadius << 1;

                var imgCellCropped = self.cropImgBoxs([cell.lat, cell.lng], radius, radius, coords);
                cell.imgCellCropped = imgCellCropped;

                var cellCanvas = self.getCanvasCell(cell, self.options.bright_cell_color);
                self.draw([cell.lat, cell.lng], radius, radius, coords, cellCanvas);
            }
        }

        return cell;
    },

    redrawCell: function(cell) {
        if (cell && cell.imgCellCropped) {
            this.redrawImgCropped(cell.imgCellCropped);
        }
    },

    onMouseMove: function(e) {
        // this.determineCell([e.latlng.lat, e.latlng.lng]);

        var self = this;
        var map = this.options.map;
        if (self.timeoutID) clearTimeout(self.timeoutID);

        self.timeoutID = setTimeout(function() {
            timeoutID = 0;
            // coverageLayer.backupOne();
            var zoom = map.getZoom();
            var currentLatLng = e.latlng;
            var currentPoint = map.project(currentLatLng, zoom);

            var x = (currentPoint.x / TILESIZE) >> 0;
            var y = (currentPoint.y / TILESIZE) >> 0;

            var tileID = zoom + "_" + x + "_" + y;
            var coords = L.point(x, y);
            coords.z = zoom;

            // var tilePoint = coverageLayer._tilePoint(coords, [currentLatLng.lat, currentLatLng.lng]);
            // tilePoint = L.point(tilePoint[0], tilePoint[1]);
            function getIntersectPoly(currentlatlng) {
                var rtree = self._rtreePolygon;
                if (rtree) {
                    var lat = currentlatlng.lat;
                    var lng = currentlatlng.lng;
                    var result = rtree.search([lat, lng, lat, lng]);

                    if (result.length > 0) {
                        var polys = [];
                        var topPoly, id = -1;
                        for (var i = 0; i < result.length; i++) {
                            var r = result[i];
                            var poly = r[4];

                            if (poly.in(currentlatlng)) {
                                polys.push(poly);
                                if (r[5] > id) {
                                    topPoly = poly;
                                    id = r[5];
                                }
                            }
                        }
                        polys.topPoly = topPoly;
                        polys.topPolyID = id;

                        return polys;
                    }
                }
                return [];
            }

            var polys = getIntersectPoly(currentLatLng);

            if (!self._cellRadius) self._cellRadius = 0;
            var pad = L.point(self._cellRadius, self._cellRadius);
            var tlPts = currentPoint.subtract(pad);
            var brPts = currentPoint.add(pad);
            var nw = map.unproject(tlPts, zoom);
            var se = map.unproject(brPts, zoom);
            var bound = [se.lat, nw.lng, nw.lat, se.lng];

            function getIntersectCell(bound) {
                if (!self._rtreeCell)
                    return [];

                var cells = self._rtreeCell.search(bound);

                var result = [];
                var id = -1,
                    topCell = undefined;

                function isInsideSector(point, center, radius, angle1, angle2) {
                    function areClockwise(center, radius, angle, point2) {
                        var point1 = {
                            x: (center.x + radius) * Math.cos(angle),
                            y: (center.y + radius) * Math.sin(angle)
                        };
                        return -point1.x * point2.y + point1.y * point2.x > 0;
                    }

                    var relPoint = {
                        x: point.x - center.x,
                        y: point.y - center.y
                    };

                    return !areClockwise(center, radius, angle1, relPoint) &&
                        areClockwise(center, radius, angle2, relPoint) &&
                        (relPoint.x * relPoint.x + relPoint.y * relPoint.y <= radius * radius);
                }

                if (cells.length > 0) {
                    for (var i = 0; i < cells.length; i++) {
                        var r = cells[i];
                        var cell = r[4];
                        var center = map.project(L.latLng(cell.lat, cell.lng));
                        if (isInsideSector(currentPoint, center, self._cellRadius, cell.startRadian, cell.endRadian)) {
                            result.push(cell);
                            var a = r[5];
                            if (cell.cell_type == CELLTYPE2G && !self.drawCell2G)
                                continue;
                            if (cell.cell_type == CELLTYPE3G && !self.drawCell3G)
                                continue;

                            if (id < a) {
                                topCell = cell;
                                id = a;
                            }
                        }
                    }

                    result.topCell = topCell;
                    result.topCellID = id;
                    return result;
                }

                return [];
            }

            var cells = getIntersectCell(bound);

            var cell = cells.topCell;
            var poly = polys.topPoly;
            // if (cell && ((cell.cell_type == CELLTYPE2G && !self.drawCell2G) || (cell.cell_type == CELLTYPE3G && !self.drawCell3G))) {
            //     cell = undefined;
            // }

            if (cell || poly) {
                $('.leaflet-container').css('cursor', 'pointer');
                // var cell = cells.topCell;
                if (cell) {
                    if (self.lastRecentInfo.cellID == cells.topCellID) {

                    } else {
                        if (self.lastRecentInfo.imgCellCropped) {
                            self.redrawImgCropped(self.lastRecentInfo.imgCellCropped);
                        }

                        self.lastRecentInfo.cellID = cells.topCellID;
                        self.lastRecentInfo.cell = cell;
                        self.lastRecentInfo.cells = cells;

                        var radius = (self._cellRadius) << 1;
                        self.lastRecentInfo.imgCellCropped = self.cropImgBoxs([cell.lat, cell.lng], radius, radius, coords);

                        if (!self.lastRecentInfo.poly) { //case: mouse move from blank area to cell
                            var cellCanvas = self.getCanvasCell(cell, self.options.hover_cell_color);
                            self.draw([cell.lat, cell.lng], radius, radius, coords, cellCanvas);
                        }
                        // console.log("here");
                    }
                } else {
                    // console.log("here");
                    if (self.lastRecentInfo.cellID == undefined) {

                    } else {
                        self.lastRecentInfo.cellID = undefined;
                        self.lastRecentInfo.cell = undefined;
                        self.lastRecentInfo.cells = undefined;

                        self.redrawImgCropped(self.lastRecentInfo.imgCellCropped);
                    }
                }

                // var poly = polys.topPoly;
                if (poly && !cell) {
                    if (self.lastRecentInfo.polyID && (polys.topPolyID == self.lastRecentInfo.polyID)) {

                    } else {

                        if (self.lastRecentInfo.imgPolyCropped)
                            self.redrawImgCropped(self.lastRecentInfo.imgPolyCropped);

                        self.lastRecentInfo.polyID = polys.topPolyID;
                        self.lastRecentInfo.poly = poly;

                        var sizeWidth = poly.size[0];
                        var sizeHeigth = poly.size[1];
                        if (sizeWidth != 0 && sizeHeigth != 0) {
                            self.lastRecentInfo.imgPolyCropped = self.cropImgBoxs(poly.posL, poly.size[0], poly.size[1], coords);
                            self.draw2(poly.TL, poly.size[0], poly.size[1], coords, poly.canvas2);
                            // self.draw(poly.posL, poly.size[0], poly.size[1], coords, poly.canvas2);
                        }
                    }
                } else {
                    if (self.lastRecentInfo.polyID == undefined) {

                    } else {
                        self.lastRecentInfo.polyID = undefined;
                        self.lastRecentInfo.poly = undefined;
                        self.redrawImgCropped(self.lastRecentInfo.imgPolyCropped);

                        if (self.lastRecentInfo.cell) { //case: mouse move from poly to cell
                            var cellCanvas = self.getCanvasCell(cell, self.options.hover_cell_color);
                            self.draw([cell.lat, cell.lng], radius, radius, coords, cellCanvas);
                        }
                    }
                }

            } else {
                $('.leaflet-container').css('cursor', 'auto');
                if (self.lastRecentInfo.cellID == undefined && self.lastRecentInfo.polyID == undefined) {

                } else {

                    self.lastRecentInfo.cellID = undefined;
                    self.lastRecentInfo.cell = undefined;
                    self.lastRecentInfo.polyID = undefined;
                    self.lastRecentInfo.poly = undefined;
                    self.lastRecentInfo.cells = undefined;

                    self.redrawImgCropped(self.lastRecentInfo.imgPolyCropped);
                    self.redrawImgCropped(self.lastRecentInfo.imgCellCropped);
                }
            }
        }, 0);
    },

    redrawImgCropped: function(imgs) {
        if (imgs && imgs.length) {
            for (var i = 0; i < imgs.length; i++) {
                var image = imgs[i];
                image.draw();
            }
        }
    },

    putImageData: function(topPointlatlng, WIDTH, HEIGHT, coords, imgData) {
        var w = WIDTH >> 1;
        var h = HEIGHT >> 1;
        var lat = topPointlatlng[0];
        var lng = topPointlatlng[1];
        var topPts = [lat, lng];

        // var WIDTH,HEIGHT;
        // WIDTH = HEIGHT = coverageLayer.options.radius;                

        var topPointTile = this._tilePoint(coords, topPts);

        var tileIDs = getTileIDs(topPointTile, WIDTH, HEIGHT, coords);

        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];
            var canvas = tile.canvas;
            var coords = tile.coords;
            var tilePoint = this._tilePoint(coords, topPts);
            if (canvas) {
                var ctx = canvas.getContext('2d');
                // img.onload= function(){
                // drawImage(ctx, img, tilePoint[0] - w, tilePoint[1] - h);
                // console.log(w, h);
                ctx.putImageData(imgData, tilePoint[0] - w, tilePoint[1] - h);
            }
        }
    },


    draw2: function(topLeftlatlng, WIDTH, HEIGHT, coords, img) {
        var lat = topLeftlatlng[0];
        var lng = topLeftlatlng[1];
        var topLeft = [lat, lng];

        var tlPointTile = this._tilePoint(coords, topLeft);

        var tileIDs = this.getTileIDs2(tlPointTile, WIDTH, HEIGHT, coords);


        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];
            // console.log(tile);

            var canvas = tile.canvas;
            var coords = tile.coords;
            var tilePoint = this._tilePoint(coords, topLeft);
            if (canvas) {
                var ctx = canvas.getContext('2d');
                // img.onload= function(){
                this.drawImage(ctx, img, tilePoint[0], tilePoint[1]);
                // this.drawImage(ctx, img, 0, 0);
            }
        }
    },

    draw: function(topPointlatlng, WIDTH, HEIGHT, coords, img) {
        var w = WIDTH >> 1;

        if (WIDTH & 1 == 1)
            w = (WIDTH >> 1) + 1;
        else w = WIDTH >> 1;

        var h;
        if (HEIGHT & 1 == 1)
            h = (HEIGHT >> 1) + 1;
        else h = HEIGHT >> 1;

        // console.log("draw: ", WIDTH, HEIGHT, w, h);


        var lat = topPointlatlng[0];
        var lng = topPointlatlng[1];
        var topPts = [lat, lng];

        // var WIDTH,HEIGHT;
        // WIDTH = HEIGHT = coverageLayer.options.radius;

        var topPointTile = this._tilePoint(coords, topPts);

        var tileIDs = this.getTileIDs(topPointTile, WIDTH, HEIGHT, coords);

        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];
            // console.log(tile);

            var canvas = tile.canvas;
            var coords = tile.coords;
            var tilePoint = this._tilePoint(coords, topPts);
            if (canvas) {
                var ctx = canvas.getContext('2d');
                // img.onload= function(){
                this.drawImage(ctx, img, tilePoint[0] - w, tilePoint[1] - h);
                // this.drawImage(ctx, img, 0, 0);
            }
        }
    },

    getTileIDs2: function(tlPoint, WIDTH, HEIGHT, coords) {
        var minX = tlPoint[0];
        var minY = tlPoint[1];
        var maxX = minX + WIDTH;
        var maxY = minY + HEIGHT;

        var tileIDX = coords.x;
        var tileIDY = coords.y;
        var zoom = coords.z;

        var tileIDs = [];
        var mina = 0,
            minb = 0,
            maxa = 0,
            maxb = 0;

        if (minX < 0) {
            mina = -((((-minX) / TILESIZE) >> 0) + 1);
            // console.log("mina", mina);
        }
        if (minY < 0) {
            minb = -((((-minY) / TILESIZE) >> 0) + 1);
            // console.log("minb", minb);
        }
        if (maxX >= TILESIZE) {
            maxa = (((maxX - TILESIZE) / TILESIZE) >> 0) + 1;
        }
        if (maxY >= TILESIZE) {
            maxb = (((maxY - TILESIZE) / TILESIZE) >> 0) + 1;
            // console.log("maxb", maxb);
        }

        for (var i = mina; i <= maxa; i++)
            for (var j = minb; j <= maxb; j++) {
                tileIDs.push(this.getID(zoom, tileIDX + i, tileIDY + j)) //8
            }

        return tileIDs;
    },


    getTileIDs: function(centrePoint, WIDTH, HEIGHT, coords) {
        // var TopPoint = info.topPointTile;
        // console.log("--------",info)        
        w = WIDTH >> 1;
        h = HEIGHT >> 1;


        var minX = centrePoint[0] - w;
        var minY = centrePoint[1] - h;
        var maxX = centrePoint[0] + w;
        var maxY = centrePoint[1] + h;

        // console.log(minX,minY,maxX,maxY);

        var tileIDX = coords.x;
        var tileIDY = coords.y;
        var zoom = coords.z;

        // var tileIDs = [getID(zoom, tileIDX, tileIDY)];
        var tileIDs = [];
        var mina = 0,
            minb = 0,
            maxa = 0,
            maxb = 0;

        // console.log("---------------------------------------")
        if (minX < 0) {
            mina = -((((-minX) / TILESIZE) >> 0) + 1);
            // console.log("mina", mina);
        }
        if (minY < 0) {
            minb = -((((-minY) / TILESIZE) >> 0) + 1);
            // console.log("minb", minb);
        }
        if (maxX >= TILESIZE) {
            maxa = (((maxX - TILESIZE) / TILESIZE) >> 0) + 1;
        }
        if (maxY >= TILESIZE) {
            maxb = (((maxY - TILESIZE) / TILESIZE) >> 0) + 1;
            // console.log("maxb", maxb);
        }

        for (var i = mina; i <= maxa; i++)
            for (var j = minb; j <= maxb; j++) {
                tileIDs.push(this.getID(zoom, tileIDX + i, tileIDY + j)) //8
            }

        return tileIDs;
    },

    getID: function(zoom, x, y) {
        var _x = x < 0 ? 0 : x;
        var _y = y < 0 ? 0 : y;
        var result = {};

        var id = zoom + "_" + _x + "_" + _y;
        result.id = id;
        result.coords = L.point(_x, _y);
        result.coords.zoom = zoom;

        var canvas = this.canvases.get(id);
        if (canvas) result.canvas = canvas;
        return result;

        var tile = this.tiles.get(result.id);

        if (tile) {
            result.canvas = tile.canvas;
            if (!result.canvas) console.log("No canvas 1");
        } else {
            var tile = this.hugeTiles.get(result.id);
            if (tile) {
                result.canvas = tile.canvas;
                if (!result.canvas) console.log("No canvas 2");
            } else {
                result.canvas = this.canvases.get(result.id);
            }
        }
        return result;
    },

    cropImage: function(canvas, centrePoint, WIDTH, HEIGHT, alph) {
        var context = canvas.getContext('2d');
        // w = w << 1;
        // h = h << 1;
        // var WIDTH = (w << 1);
        // var HEIGHT = (h << 1);

        w = WIDTH >> 1;
        h = HEIGHT >> 1;

        // var imgSize = (WIDTH * HEIGHT) << 2;

        // if (!MEM || MEM.byteLength < imgSize)
        //     MEM = new ArrayBuffer(imgSize);

        var minX = (centrePoint[0] - w);
        var minY = (centrePoint[1] - h);
        minX = (minX < 0) ? (minX - 0.5) >> 0 : (minX + 0.5) >> 0; //round();
        minY = (minY < 0) ? (minY - 0.5) >> 0 : (minY + 0.5) >> 0; //round();


        var maxX = minX + WIDTH;
        var maxY = minY + HEIGHT;

        if (minX < 0)
            minX = 0;


        if (minY < 0)
            minY = 0;

        if (maxX > TILESIZE)
            maxX = TILESIZE;

        if (maxY > TILESIZE)
            maxY = TILESIZE;

        // console.log(minX, minY, maxX, maxY);

        var width = maxX - minX;
        var height = maxY - minY;
        // console.log(WIDTH,HEIGHT,maxY,minY, width, height);

        if (width == 0 || height == 0) {
            return new Image();
        }

        var subCanvas = document.createElement('canvas');
        subCanvas.width = width;
        subCanvas.height = height;
        var subContext = subCanvas.getContext('2d');

        if (!canvas.imgData) {
            // var start = new Date().getTime();
            // var img = new Image();

            // console.log("Create new ImageData");
            var pix = context.getImageData(0, 0, TILESIZE, TILESIZE);
            canvas.imgData = new ImageBuffer(pix);
            // var end = new Date().getTime();
            // var time = end - start;
            // console.log("Traditional way : ", end - start);
        }


        // var start = new Date().getTime();
        var img = new Image();
        // for (var j = 0;j<100;++j){          

        // var sz = ((width*height) << 2) >> 0;
        // console.log("Array length ",sz);
        // var buf = new Uint8ClampedArray(MEM, 0, sz );
        var imgData = subContext.createImageData(width, height);

        var buffer = new ImageBuffer(imgData);

        var color = {};
        var data = canvas.imgData;
        // console.log(SUPPORTS_32BIT);

        for (var y = 0; y < height; ++y) {
            for (var x = 0; x < width; ++x) {
                data.getPixelAt(x + minX, y + minY, color);

                if (color.a != 255) {
                    color.r = 0;
                    color.g = 0;
                    color.b = 0;
                    color.a = 0;
                }

                buffer.setPixelAt(x, y, color.r, color.g, color.b, color.a);
            }
        }

        // imgData.data.set(buf);

        subContext.putImageData(imgData, 0, 0);
        img.src = subCanvas.toDataURL("image/png");
        // if (img.complete) {
        //     context.drawImage(img, 0, 0);
        // }
        // else {
        //   img.onload = function(){
        //     context.drawImage(img, 0, 0);
        //   }
        // }
        // var end = new Date().getTime();
        // var time = end - start;
        // console.log("New way : ",end-start);
        // }
        return img;
    },

    drawImage: function(ctx, image, x, y) {
        function f() {
            this.drawImage(ctx, image, x, y);
        }

        try {
            if (image.width == 0 || image.height == 0)
                return;
            else
                ctx.drawImage(image, x, y);
        } catch (e) {
            if (e.name == "NS_ERROR_NOT_AVAILABLE") {
                // Wait a bit before trying again; you may wish to change the
                // length of this delay.
                setTimeout(f, 100);
            } else {
                throw e;
            }
        }
    },

    cropImgBoxs: function(centreLatLng, WIDTH, HEIGHT, coords) {
        var topPointTile = this._tilePoint(coords, [centreLatLng[0], centreLatLng[1]]);

        var w = WIDTH >> 1; //  mean  w/=2
        var h = HEIGHT >> 1; //  mean  w/=2        

        var tileIDs = this.getTileIDs(topPointTile, WIDTH, HEIGHT, coords);

        var result = [];
        // if (globalResults.length > 0)
        //     console.log("Heep heep hurayyyyyyyyy ", globalResults.length);
        var lat = centreLatLng[0];
        var lng = centreLatLng[1];
        var topPts = [lat, lng];

        var self2 = this;

        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];
            var canvas = tile.canvas;
            if (!canvas) {
                // console.log("No canvas ", tile);
                continue;
            }
            var coords = tile.coords;
            var tilePoint = this._tilePoint(coords, topPts);
            var img = this.cropImage(canvas, tilePoint, WIDTH, HEIGHT, 255);

            var o = {};
            o.canvas = canvas;
            o.tilePoint = tilePoint;
            o.img = img;
            o.ctx = canvas.getContext('2d');
            // globalResults.push(o);

            o.draw = function() {
                // var WIDTH = (w << 1);
                // var HEIGHT = (h << 1);
                var minX = (this.tilePoint[0] - w);
                var minY = (this.tilePoint[1] - h);
                minX = (minX < 0) ? (minX - 0.5) >> 0 : (minX + 0.5) >> 0;
                minY = (minY < 0) ? (minY - 0.5) >> 0 : (minY + 0.5) >> 0;

                if (minX < 0)
                    minX = 0;

                if (minY < 0)
                    minY = 0;

                var self = this;

                if (self.img.complete) {
                    self2.drawImage(self.ctx, self.img, minX, minY);
                    // self2.drawImage(self.ctx, self.img, 100, 100);
                    // self.ctx.drawImage(self.img, 0, 0);
                } else {
                    self.img.onload = function(e) {
                        // self.img.loaded = true;
                        if (self.img.complete) {
                            self.ctx.drawImage(self.img, minX, minY);
                        } else {
                            var maxTimes = 10;
                            var countTimes = 0;

                            function retryLoadImage() {
                                setTimeout(function() {
                                    if (countTimes > maxTimes) {
                                        // -- cannot load image.
                                        return;
                                    } else {
                                        if (e.target.complete == true) {
                                            self2.drawImage(self.ctx, self.img, minX, minY);
                                        } else {
                                            console.log("here");
                                            self.img.src = self.img.src;
                                            retryLoadImage();
                                        }
                                    }
                                    countTimes++;
                                }, 100);
                            };
                            retryLoadImage();
                        }
                    }
                }
            }
            result.push(o);
        }
        return result;
    },

    // -------------------------------------------------------------------

    getId: function(coords) {
        return coords.z + "_" + coords.x + "_" + coords.y;
    },

    getCoords: function(id) {
        var res = id.split("_");
        var coords = L.point(res[1], res[2]);
        coords.z = res[0];
        return coords;
    },

    iscollides: function(coords) {
        var tileSize = this.options.tileSize;

        var nwPoint = coords.multiplyBy(tileSize); //coordinate of tile by world point
        var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));
        var nw = this._map.unproject(nwPoint, coords.z);
        var se = this._map.unproject(sePoint, coords.z);
        var tileBB = L.latLngBounds([nw, se]);

        // console.log("tilebox: ",tileBB);

        var bb = this.BBAllPointLatlng;
        var southWest = L.latLng(bb[0], bb[1]),
            northEast = L.latLng(bb[2], bb[3]);
        var GBB = L.latLngBounds(southWest, northEast);

        // console.log("GBOX: ",GBB);
        return GBB.intersects(tileBB);
    },

    createTile: function(coords) {
        // var id = this.getId(coords);
        // var savedTile = this.hugeTiles.get(id) || this.tiles.get(id); //check if tile in lru mem cache

        // var canvas = (savedTile && savedTile.canvas) ? savedTile.canvas : document.createElement('canvas');
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = this.options.tileSize;

        if (this.options.debug) {
            this._drawDebugInfo(canvas, coords);
        }

        this._draw(canvas, coords);

        // if (savedTile) {
        //     savedTile.canvas = canvas;
        // }

        return canvas;
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

    // getVertexAndBoundinLatLng: function(poly) {
    //     var map = this.options.map;
    //     var zoom = 12; //map.getZoom();
    //     // console.log("zoom", zoom);

    //     var tempVertexsP = [];
    //     for (var i = 0; i < poly.length; i++) {
    //         var p = poly[i];
    //         tempVertexsP.push(L.point(p.x, p.y));
    //     }

    //     var bound = L.bounds(tempVertexsP);
    //     var tempCenterP = bound.getCenter();

    //     var centerL = L.latLng(poly.posL[0], poly.posL[1]);
    //     var centerP = map.project(centerL, zoom);

    //     var distance = centerP.subtract(tempCenterP);

    //     var vertexsL = [];
    //     for (var i = 0; i < poly.length; i++) {
    //         var vertexP = tempVertexsP[i].add(distance);
    //         var vertexL = map.unproject(vertexP, zoom);
    //         vertexsL.push(vertexL);
    //     }

    //     poly.vertexsL = vertexsL;
    //     poly.lBounds = L.latLngBounds(vertexsL);
    // },

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
                var nw = poly.lBounds.getNorthWest();
                poly.TL = [nw.lat, nw.lng];

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
                var nw = poly.lBounds.getNorthWest();
                poly.TL = [nw.lat, nw.lng];


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

    /* sector format
    var sector = {
        radius: 100,
        lat: 200,
        lng: 200,
        startingAngle: 200, //cloclwise, start from 0 degree, in degree
        arcSize: 100, // in degree
        color: "#FF0066"
    }
    */

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

            for (var i = 0; i < dataCell.length; i++) {
                var cell = dataCell[i];

                var azimuth = cell.azimuth;
                var azimuthR = this.degreeToRadian(azimuth);

                cell.biRadian = NORTH + azimuthR;
                cell.startRadian = cell.biRadian - HCELLARCSIZE;
                cell.endRadian = cell.biRadian + HCELLARCSIZE;

                var sector = [cell.lat, cell.lng, cell.lat, cell.lng, cell, i];

                sectors.push(sector);
            }

            return sectors;
        }
    },


    // makeRtree: function() {
    //     var self = this;

    //     var promise = new Promise(function(res, rej) {

    //         var craziness = operative({
    //             doCrazy: function(rtree_loaded) {
    //                 var deferred = this.deferred();
    //                 if (!rtree_loaded) {
    //                     // console.time('send');

    //                     var minXLatLng = 1000,
    //                         minYLatLng = 1000,
    //                         maxXLatLng = -1000,
    //                         maxYLatLng = -1000;
    //                     var buffer = new ArrayBuffer(8 * dataset.length * 2);
    //                     var arr = new Float64Array(buffer, 0);
    //                     var j = 0;
    //                     for (var i = 0; i < dataset.length; ++i) {
    //                         var item = dataset[i];
    //                         var x = item[0];
    //                         var y = item[1];

    //                         arr[j] = x;
    //                         arr[++j] = y;
    //                         ++j;

    //                         if (x < minXLatLng) minXLatLng = x;
    //                         if (y < minYLatLng) minYLatLng = y;
    //                         if (x > maxXLatLng) maxXLatLng = x;
    //                         if (y > maxYLatLng) maxYLatLng = y;
    //                     }
    //                     var BBAllPointLatlng = [minXLatLng, minYLatLng, maxXLatLng, maxYLatLng];

    //                     deferred.fulfill({
    //                         'buffer': buffer,
    //                         'bb': BBAllPointLatlng
    //                     }, [buffer]);

    //                     // console.timeEnd('send');
    //                 } else {
    //                     deferred.fulfill(undefined);
    //                 }
    //             }
    //         }, ['data-light.js']);

    //         craziness.doCrazy(self.rtree_loaded).then(function(result) {
    //             if (!self.rtree_loaded && result) {
    //                 var buffer = result.buffer;
    //                 var data = [];
    //                 var arr = new Float64Array(buffer, 0);
    //                 var j = 0;
    //                 for (var i = 0; i < arr.length; i += 2) {
    //                     var x = arr[i];
    //                     var y = arr[i + 1];
    //                     var item = [x, y];
    //                     data.push([x, y, x, y, item, j++]);
    //                 }
    //                 self._rtree.clear().load(data);
    //                 self.rtree_loaded = true;
    //                 self.BBAllPointLatlng = result.bb;
    //                 res();
    //                 craziness.terminate();
    //             } else {
    //                 reject();
    //             }
    //         });
    //     });

    //     return promise;
    // },

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

    clearPolyMarker: function(boundaryBox) {
        if (boundaryBox) {
            var items = this._rtreePolygon.search(boundaryBox);
            for (var i = 0; i < items; i++) {
                var item = items[i];
                this._rtreePolygon.remove(item);
            }
        } else {
            this._rtreePolygon.clear();
        }
        this._maxRadius = this.options.radius;
    },


    clearCell: function(boundaryBox) {
        if (boundaryBox) {
            var items = this._rtreeCell.search(boundaryBox);
            for (var i = 0; i < items; i++) {
                var item = items[i];
                this._rtreeCell.remove(item);
            }
        } else {
            this._rtreeCell.clear();
        }
        this._maxRadius = this.options.radius;
    },

    addPolygonMarker: function(dataPoly) {
        if (this._rtreePolygon)
            this._rtreePolygon.load(this.makeDataPoly(dataPoly));
    },

    // //important function
    // getStoreObj: function(id) {

    //     /**
    //      * @ general description This function try to get tile from db,
    //      * if tile is founded, then it immediately set it up to lru head
    //      */

    //     var db = this.options.db;

    //     var self = this;
    //     var promise = new Promise(function(res, rej) {
    //         if (!self.ready) { //need to wait for all old data be deleted
    //             rej("Not ready");
    //             return;
    //         }

    //         if (db) {
    //             db.get(id, {
    //                 attachments: false
    //             }).then(function(doc) {
    //                 if (self.options.debug) console.log("Found ------------------- ", doc);
    //                 // var tile = {
    //                 //     _id: doc._id,
    //                 //     status : LOADED,
    //                 //     data: doc.data,
    //                 //     bb: doc.bb,
    //                 //     _rev : doc._rev,
    //                 //     needSave: false
    //                 // };
    //                 // var id = doc._id;

    //                 doc.status = LOADED;
    //                 doc.needSave = false;
    //                 if (!doc.img && doc.numPoints > 0) {
    //                     var blob = doc.image;
    //                     var blobURL = blobUtil.createObjectURL(blob);

    //                     var newImg = new Image();
    //                     newImg.src = blobURL;
    //                     doc.img = newImg;
    //                     doc.imgFromDB = true;
    //                     // setTimeout(function() {                            
    //                     //     var canvas = self.canvases.get(id);
    //                     //     var ctx = canvas.getContext('2d');
    //                     //     ctx.drawImage(newImg, -100, -100);                        
    //                     // }, 300);
    //                     if (doc.numPoints < HUGETILE_THREADSHOLD) {
    //                         var nTile = self.tiles.get(id);
    //                         if (!nTile || !nTile.img)
    //                             self.store(id, doc);
    //                     } else {
    //                         var nTile = self.hugeTiles.get(id);
    //                         if (!nTile || !nTile.img)
    //                             self.hugeTiles.set(id, doc);
    //                     }
    //                 }
    //                 // resolve(res);  
    //                 res(doc);
    //             }).catch(function(err) {
    //                 console.log(err);
    //                 rej(err);
    //             });
    //         } else rej(new Error("No DB found"));
    //     });

    //     return promise;
    // },

    // all_tiles_id: new lru(4000),

    // //important function
    // getTile: function(coords) {

    //     /**

    //      * @general description: this function check if tile in cache (lru or db)
    //      * if tile is not founded, then we create tile data by RTREE, and then we cache this tile to lru immediately    
    //      */
    //     var id = coords.z + "_" + coords.x + "_" + coords.y;

    //     var valid = this.iscollides(coords);
    //     //Dau tien kiem tra tile trong bo nho RAM

    //     var tile = this.hugeTiles.get(id) || this.tiles.get(id);
    //     var self = this;
    //     // if (tile) console.log("Status ",tile.status);

    //     // if not found
    //     if (!tile || tile.status == UNLOAD) {
    //         //use empty tiles( save almost empty tile) to prevent find empty tile in dabase many time, because
    //         //query data in db is time comsuming , so we check if tile is empty by query it in memory first.
    //         if (self.emptyTiles.get(id))
    //             return Promise.resolve(EMPTY);

    //         if (!tile) {
    //             tile = {};
    //         }

    //         tile.status = LOADING;

    //         self.store(id, tile);

    //         var promise = new Promise(function(resolve, reject) {
    //             //sau do kiem tra trong o cung                
    //             var out = self.getStoreObj(id).then(function(res) {

    //                 self.store(id, res);
    //                 res.status = LOADED;

    //                 if (res.numPoints == 0) {
    //                     self.emptyTiles.set(id, {});
    //                     self.tiles.remove(id);
    //                     if (self.needPersistents > self.tiles.size)
    //                         self.needPersistents--;
    //                     console.log("Store empty tile ", self.emptyTiles.size);
    //                 }

    //                 resolve(res);

    //             }, function(err) {
    //                 //neu trong o cung khong co thi lay trong RTREE                    

    //                 var tileSize = self.options.tileSize;
    //                 var nwPoint = coords.multiplyBy(tileSize);
    //                 var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

    //                 if (self.options.useAbsoluteRadius) {
    //                     var centerPoint = nwPoint.add(new L.Point(tileSize / 2, tileSize / 2));
    //                     self._latLng = self._map.unproject(centerPoint, coords.z);
    //                 }

    //                 // padding
    //                 var pad = new L.Point(self._getMaxRadius(coords.z), self._getMaxRadius(coords.z));
    //                 nwPoint = nwPoint.subtract(pad);
    //                 sePoint = sePoint.add(pad);

    //                 var bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z),
    //                     self._map.unproject(nwPoint, coords.z));

    //                 var currentBounds = self._boundsToQuery(bounds);
    //                 var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];
    //                 // console.log(bb);
    //                 var pointCoordinates = (self.options.useGlobalData) ? null : self._rtree.search(bb);


    //                 //Create RTREE_cached
    //                 if (!self.all_tiles_id.get(id)) {
    //                     self.all_tiles_id.set(id, {});
    //                     self.rtree_cachedTile.insert([bb[0], bb[1], bb[2], bb[3], id]);
    //                 }


    //                 if (pointCoordinates && pointCoordinates.length === 0) {

    //                     console.log("here");

    //                     console.log("Store empty tile ", self.emptyTiles.size);
    //                     self.emptyTiles.set(id, {});

    //                     self.tiles.remove(id);
    //                     if (self.needPersistents > self.tiles.size)
    //                         self.needPersistents--;
    //                     // console.log("Remove empty tile from current saved tiles",self.tiles.size);
    //                     resolve(EMPTY);
    //                     return;
    //                 }

    //                 var numPoints = (pointCoordinates) ? pointCoordinates.length : 0;
    //                 tile = {
    //                     _id: id,
    //                     numPoints: numPoints,
    //                     data: pointCoordinates,
    //                     bb: bb,
    //                     status: LOADED,
    //                     needSave: true,
    //                     justcreated: true,
    //                 }

    //                 console.log("in here 7", tile);

    //                 //after create tile with RTREE, we save it down to lru cache and db immediately/

    //                 if (numPoints >= HUGETILE_THREADSHOLD) {
    //                     console.log("here1");
    //                     var nTile = self.hugeTiles.get(id);
    //                     if (!nTile || nTile.status != LOADED) {
    //                         self.hugeTiles.set(id, tile);
    //                         self.tiles.remove(id);
    //                         resolve(tile);
    //                     } else resolve(nTile);

    //                 } else {
    //                     var nTile = self.tiles.get(id);
    //                     if (!nTile || nTile.status != LOADED) {
    //                         self.store(id, tile);
    //                         resolve(tile);
    //                     } else resolve(nTile);
    //                 }
    //             })
    //         });

    //         return promise;
    //     }

    //     tile.needSave = (tile.status == LOADED) ? false : true;
    //     if (tile.justcreated) tile.needSave = true;
    //     console.log("get tile", tile);
    //     return Promise.resolve(tile);
    // },

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

    // timeoutId: undefined,

    // //important function
    // backupOne: function() {
    //     //this function is excute after mouse cursor stop moving by 0ms

    //     var self = this;

    //     if (this.timeoutId) clearTimeout(this.timeoutId);

    //     this.timeoutId = setTimeout(function() {
    //         // console.log("here");
    //         this.timeoutId = 0;
    //         var db = self.options.db;
    //         if (db && self.needPersistents > 0) {

    //             var node = self.tiles.head;
    //             while (node) {
    //                 var value = node.value;
    //                 if (value.needSave) {
    //                     self.backupToDb(db, value);
    //                     console.log("Backup once ", value);
    //                     break;
    //                 }
    //                 node = node.next;
    //             }
    //             self.needPersistents--;
    //         }
    //     }, 0);

    // },

    // worker: undefined,


    // //important function
    // backupToDb: function(db, tile) {

    //     if (tile.needSave && tile.status == LOADED && !tile.empty) {
    //         var self = this;
    //         tile.needSave = false; // change needSave field = false, so we know to don't duplicate save the same tile to db in later
    //         // console.log("Remove from memory 22, backup to DB ", tile);
    //         // var db = self.options.db;
    //         if (db) {

    //             var promise2 = new Promise(function(resolve2, reject2) {
    //                 var resolved2 = false;

    //                 // console.log('Back up to DB',db);
    //                 if (self.needPersistents > 0) self.needPersistents--;
    //                 // function retryUntilWritten(id, name, rev, blob, type, callback) {

    //                 var simpleTile = {
    //                     _id: tile._id,
    //                     numPoints: tile.numPoints,
    //                     data: self.options.useGlobalData ? undefined : tile.data,
    //                     bb: tile.bb,
    //                     status: LOADED,
    //                     needSave: false
    //                 }

    //                 if (self.options.useGlobalData) {
    //                     delete simpleTile.data;
    //                     delete simpleTile.sorted;
    //                 }

    //                 if (tile._id == "10_813_451")
    //                     console.log("in here5");


    //                 var getBlob = function(tile) {
    //                     // console.log("---------------------------");
    //                     if (tile.img) {
    //                         // console.log("IMG");
    //                         return blobUtil.imgSrcToBlob(tile.img.src);
    //                     } else if (tile.canvas) {
    //                         // console.log("CANVAS");
    //                         return blobUtil.canvasToBlob(tile.canvas);
    //                     } else return Promise.resolve();
    //                     // console.log("---------------------------");
    //                 }

    //                 var promise = new Promise(function(resolved, reject) {
    //                     if (tile.numPoints > 0 && (tile.canvas || tile.img)) {
    //                         getBlob(tile).then(function(blob) {

    //                             if (tile._id == "10_813_451")
    //                                 console.log("in here4");

    //                             simpleTile.image = blob;

    //                             if (!self.worker) {

    //                                 //********Web worker******
    //                                 //**************************

    //                                 /**
    //                                  * I hope that operative will fallback to setTimeout in case of no web-worker support.
    //                                  */

    //                                 /**
    //                                  * @description  web worker only see variable and function in worker scope (
    //                                  * because web worker be written on individual blob or file), -> cannot see
    //                                  * any variable or function in outer scope
    //                                  *
    //                                  *  but why if replace this by self, this code still work correct ? 
    //                                  */

    //                                 self.worker = operative({
    //                                     db: undefined,

    //                                     backup: function(simpleTile, callback) {

    //                                         //Only need to create DB object only once
    //                                         if (!this.db) {
    //                                             this.db = new PouchDB('vmts');
    //                                         }

    //                                         this.db.get(simpleTile._id).then(function(doc) {
    //                                             //doc._rev co khi len toi 3, tuc la da duoc update lai 3 lan
    //                                             console.log(doc._rev, doc.needSave);
    //                                             simpleTile._rev = doc._rev;
    //                                             return this.db.put(simpleTile);
    //                                         }).then(function() {
    //                                             callback('ok');
    //                                             return this.db.get(simpleTile._id);
    //                                         }).then(function(doc) {
    //                                             console.log("successfully update stored object: ", doc);
    //                                         }).catch(function(err) {
    //                                             if (err.status == 404) {
    //                                                 this.db.put(simpleTile).then(function(res) {
    //                                                     console.log('successfully save new object ', res);
    //                                                     callback('ok');
    //                                                 }).catch(function(err) {
    //                                                     console.log('other err2');
    //                                                     callback(undefined);
    //                                                 });
    //                                             } else {
    //                                                 console.log('other err1');
    //                                                 callback(undefined);
    //                                             }
    //                                         });
    //                                     }
    //                                 }, ['pouchdb-4.0.3.min.js', 'pouchdb.upsert.js']);
    //                             }

    //                             //********invoke web worker******
    //                             //*********************************
    //                             if (self.worker) {
    //                                 self.worker.backup(simpleTile, function(results) {
    //                                     if (results) {
    //                                         // if (self.options.debug) console.log("Successfully update stored object: ", tile._id);
    //                                         resolved();
    //                                     } else {
    //                                         console.log('err');
    //                                         reject();
    //                                     }
    //                                 })
    //                             }

    //                         }).catch(function(err) {
    //                             console.log("cannot convert img or canvas to blob", err);
    //                             reject();
    //                         })
    //                     } else {
    //                         console.log("in here3", tile);
    //                         resolved();
    //                     }
    //                 });

    //                 if (!self.prev) self.prev = Promise.resolve();
    //                 self.prev = self.prev.then(function() {
    //                     console.log("before promise");
    //                     return promise;
    //                 }).then(function(response) {
    //                     console.log("after promise");
    //                     if (!resolved2) {
    //                         console.log("here");
    //                         resolve2();
    //                         resolved2 = true;
    //                     }
    //                 }).catch(function(err) {
    //                     console.log("Err", err);
    //                     reject2();
    //                 });

    //             });

    //             return promise2;
    //         }
    //     }


    //     return Promise.resolve();
    // },

    // //important function
    // store: function(id, tile) {
    //     var self = this;

    //     /**
    //      *No need to wait for rtree_loaded 
    //      *rtree_loaded is actually global map data
    //      *tile can be loaded from server individually, there is no need to wait for the whole map to be downloaded and store in rtree.
    //      */

    //     *        
    //      *  when rtree have not been fully loaded data, if we save tile to db,
    //      *  then when rtree is fully load data, data of some tile will change, so we need to update all tile in db.
    //      *
    //      *  additionally, when rtree contain no data, all tile is empty, so this function never been called


    //     // if (self.rtree_loaded) {
    //     // console.log("No tiles stored ",self.tiles.size);  

    //     return promsie = new Promise(function(resolve, reject) {
    //         self.tiles.set(id, tile, function(removed) {
    //             // console.log("here1");
    //             if (removed) {
    //                 console.log("removed tile", removed.value.needSave, removed.value);
    //                 return self.backupToDb(self.options.db, removed.value);
    //             } else return Promise.resolve();
    //         });
    //     })


    // },

    /**
     * @param {HTMLCanvasElement|HTMLElement} canvas
     * @param {L.Point} coords
     * @private
     */


    getTile: function(coords) {
        /**

         * @general description: this function check if tile in cache (lru or db)
         * if tile is not founded, then we create tile data by RTREE, and then we cache this tile to lru immediately    
         */

        var self = this;
        var id = this.getId(coords);

        var tile = this.tiles.get(id);
        if (tile) {
            // return tile;
        } {

            var queryPolys = function(coords) {
                if (!self._rtreePolygon)
                    return [];

                var tileSize = self.options.tileSize;

                var nwPoint = coords.multiplyBy(tileSize);
                var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

                if (self.options.useAbsoluteRadius) {
                    var centerPoint = nwPoint.add(new L.Point(tileSize >> 1, tileSize >> 1));
                    self._latLng = self._map.unproject(centerPoint, coords.z);
                }

                var bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z), self._map.unproject(nwPoint, coords.z));

                var currentBounds = self._boundsToQuery(bounds);
                var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];
                var vpolyCoordinates = self._rtreePolygon.search(bb);

                vpolyCoordinates.sort(function(a, b) {
                    return a[5] - b[5];
                })

                return {
                    vpolyCoordinates: vpolyCoordinates,
                    bb: bb,
                };
            }

            var rqpoly = queryPolys(coords);
            var vpolyCoordinates = rqpoly.vpolyCoordinates;
            var bbpoly = rqpoly.bb;


            var queryCells = function(coords) {
                if (!self._rtreeCell)
                    return [];

                var getBB = function(coords) {
                    var tileSize = self.options.tileSize;
                    var nwPoint = coords.multiplyBy(tileSize);
                    var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

                    if (self.options.useAbsoluteRadius) {
                        var centerPoint = nwPoint.add(new L.Point(tileSize / 2, tileSize / 2));
                        self._latLng = self._map.unproject(centerPoint, coords.z);
                    }

                    if (self.options.useAbsoluteRadius) {
                        // console.log("?????????????????????????????????");
                        self._cellRadius = self._calcRadius(self.cellRadius, coords.z);
                        // console.log(self._cellRadius);
                    } else {
                        self._cellRadius = self.cellRadius;
                    }

                    // padding
                    var pad;
                    // if (!padSize)
                    // pad = new L.Point(self._getMaxRadius(coords.z), self._getMaxRadius(coords.z));
                    pad = new L.Point(self._cellRadius, self._cellRadius);
                    // else
                    // pad = new L.Point(padSize, padSize);

                    // console.log(pad);
                    nwPoint = nwPoint.subtract(pad);
                    sePoint = sePoint.add(pad);

                    var bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z),
                        self._map.unproject(nwPoint, coords.z));

                    var currentBounds = self._boundsToQuery(bounds);
                    var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];

                    return bb;
                }

                var bb = getBB(coords);

                var cellCoordinates = self._rtreeCell.search(bb);

                // if (cellCoordinates.length > 0)
                // console.log("---------------------??", cellCoordinates);

                cellCoordinates.sort(function(a, b) {
                    return a[5] - b[5];
                })
                return cellCoordinates;
            }

            var cells = queryCells(coords);

            var numPolys = vpolyCoordinates.length;
            var numCells = cells.length;

            tile = {
                _id: id,
                numCells: numCells,
                numPolys: numPolys,
                dataPolys: vpolyCoordinates,
                dataCells: cells,
                bb: bbpoly,
                // bbCell:
            }

            return tile;
        }
    },


    //important function
    _draw: function(canvas, coords) {
        // var valid = this.iscollides(coords);
        // if (!valid) return;          
        if ((!this._rtreePolygon && !this._rtreeCell) || !this._map) {
            return;
        }

        var id = this.getId(coords);
        this.canvases.set(id, canvas);

        var self = this;


        var tile = this.getTile(coords);


        // var metersPerPixel = function(latitude, zoomLevel) {
        //     var earthCircumference = 40075017;
        //     var latitudeRadians = latitude * (Math.PI / 180);
        //     return earthCircumference * Math.cos(latitudeRadians) / Math.pow(2, zoomLevel + 8);
        // };

        // var pixelValue = function(latitude, meters, zoomLevel) {
        //     return meters / metersPerPixel(latitude, zoomLevel);
        // };

        // var map = this.options.map;
        // this._cellRadius = pixelValue(this._latLng.lat, this.cellRadiusMeter, coords.z);        
        this._drawVPolys(canvas, coords, tile.dataPolys);
        this.drawCells(canvas, coords, tile.dataCells);
        // this.drawCellName(canvas, coords, cells);

        this.store.set(id, tile);
    },


    store: function(id, tile) {
        var self = this;

        /**
         *No need to wait for rtree_loaded 
         *rtree_loaded is actually global map data
         *tile can be loaded from server individually, there is no need to wait for the whole map to be downloaded and store in rtree.
         */

        /**        
         *  when rtree have not been fully loaded data, if we save tile to db,
         *  then when rtree is fully load data, data of some tile will change, so we need to update all tile in db.
         *
         *  additionally, when rtree contain no data, all tile is empty, so this function never been called
         */

        // if (self.rtree_loaded) {
        // console.log("No tiles stored ",self.tiles.size);  

        // return new Promise(function(resolve, reject) {
        self.tiles.set(id, tile, function(removed) {
            // console.log("here1");
            if (removed) {
                // console.log("removed tile", removed.value.needSave, removed.value._id, removed.value);
                // return self.backupToDb(self.options.db, removed.value);
            } else {
                // console.log("not removed", tile._id, tile);
                // return Promise.resolve();
            }
        });
        // })
    },

    // drawCellNames: function(canvas, coords, cells) {

    //     var drawCellName = function(ctx, coords, cell) {
    //         var name = cell.cell_code;
    //         context.font = '40pt Calibri';
    //         context.fillStyle = 'blue';
    //         context.fillText('Hello World!', 150, 100);//     }


    //     var ctx = canvas.getContext('2d');
    //     for (var i = 0; i < cells.length; i++) {
    //         var cell = cells[i];
    //         drawCellName(ctx, coords, cell);
    //     }
    // }

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {L.Point} coords
     * @param {[{x: number, y: number, r: number}]} pointCoordinates
     * @private
     */

    // _drawPoints: function(canvas, coords, pointCoordinates, sorted) {

    //     if (!sorted) pointCoordinates.sort(function(a, b) {
    //         return a[5] - b[5];
    //     });

    //     var ctx = canvas.getContext('2d'),
    //         tilePoint;
    //     ctx.fillStyle = this.options.color;

    //     if (this.options.lineColor) {
    //         ctx.strokeStyle = this.options.lineColor;
    //         ctx.lineWidth = this.options.lineWidth || 1;
    //     }

    //     if (pointCoordinates) {
    //         // var w = ((this.options.radius+ 0.5) >> 1) | 0;
    //         // var h = ((this.options.radius+0.5) >> 1) | 0;
    //         var w = this.options.radius;
    //         var h = this.options.radius;
    //         for (var index = 0; index < pointCoordinates.length; ++index) {
    //             tilePoint = this._tilePoint(coords, pointCoordinates[index]);
    //             // console.log(tilePoint[0],tilePoint[1]);
    //             var lx = tilePoint[0] - w;
    //             var ly = tilePoint[1] - h;
    //             lx = (lx < 0) ? (lx - 0.5) >> 0 : (lx + 0.5) >> 0;
    //             ly = (ly < 0) ? (ly - 0.5) >> 0 : (ly + 0.5) >> 0;
    //             // console.log(lx,ly);
    //             ctx.drawImage(this.options.img_on, lx, ly);
    //         }
    //     }
    // },

    // drawLinhTinh: function(canvas, coords, vpolyCoordinates) {
    //     var ctx = canvas.getContext('2d');
    //     ctx.drawImage(this.options.img_on, 0, 0);
    // },

    getCanvasPoly: function(vpoly, coords, fillColor) {
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

            poly.canvas = this.getCanvasPoly(poly, coords, poly[0].c);
            poly.canvas2 = this.getCanvasPoly(poly, coords, this.options.hover_poly_color);
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

    // drawCell: function(ctx, pts, cell, radius) {
    //     // cell.startingAngle = 60;
    //     // cell.arcSize = 60;

    //     // radius = 60;

    //     var start = this.degreeToRadian(cell.startingAngle);
    //     var end = this.degreeToRadian(cell.startingAngle + cell.arcSize);
    //     var bisector = this.degreeToRadian(cell.startingAngle + cell.arcSize / 2);

    //     // console.log(start, bisector, end);

    //     var x = pts[0];
    //     var y = pts[1];

    //     var minX = 999,
    //         minY = 999,
    //         maxX = -999,
    //         maxY = -999;

    //     // var startPtsX = (radius * Math.cos(start)) >> 0;
    //     // var startPtsY = (radius * Math.sin(start)) >> 0;

    //     // var endPtsX = (radius * Math.cos(end)) >> 0;
    //     // var endPtsY = (radius * Math.sin(end)) >> 0;

    //     // var biPtsX = (radius * Math.cos(bisector)) >> 0;
    //     // var biPtsY = (radius * Math.sin(bisector)) >> 0;

    //     var startBiEndX = new Int16Array(4);
    //     var startBiEndY = new Int16Array(4);

    //     startBiEndX[0] = (radius * Math.cos(start)) >> 0;
    //     startBiEndX[1] = (radius * Math.cos(bisector)) >> 0;
    //     startBiEndX[2] = (radius * Math.cos(end)) >> 0;
    //     startBiEndX[3] = 0;

    //     startBiEndY[0] = (radius * Math.sin(start)) >> 0;
    //     startBiEndY[1] = (radius * Math.sin(bisector)) >> 0;
    //     startBiEndY[2] = (radius * Math.sin(end)) >> 0;
    //     startBiEndY[3] = 0;

    //     // console.log(Math.sin(start), Math.sin(bisector), Math.sin(end))

    //     for (var i = 0; i < startBiEndX.length; i++) {
    //         if (minX > startBiEndX[i])
    //             minX = startBiEndX[i];

    //         if (maxX < startBiEndX[i])
    //             maxX = startBiEndX[i];

    //         if (minY > startBiEndY[i])
    //             minY = startBiEndY[i];

    //         if (maxY < startBiEndY[i])
    //             maxY = startBiEndY[i];
    //     }

    //     // console.log("startBiEndX", radius, startBiEndX, cell.lat, cell.lng);
    //     // console.log("startBiEndY", radius, startBiEndY, cell.lat, cell.lng);

    //     minX = minX - 6;
    //     minY = minY - 6;
    //     maxX = maxX + 6;
    //     maxY = maxY + 6;

    //     var width = maxX - minX;
    //     var height = maxY - minY;

    //     var posCanvasX = 0;
    //     var posCanvasY = 0;
    //     if (minX < 0)
    //         posCanvasX = -minX;
    //     if (minY < 0)
    //         posCanvasY = -minY;

    //     // console.log(minX, minY, maxX, maxY, width, height, posCanvasX, posCanvasY);

    //     var getCanvas = function(color) {
    //         var canvas = document.createElement('canvas');
    //         canvas.width = width + 200;
    //         canvas.height = height + 200;
    //         var context = canvas.getContext('2d');

    //         context.beginPath();
    //         context.moveTo(posCanvasX, posCanvasY);
    //         context.arc(posCanvasX, posCanvasY, radius, start, end, false);
    //         context.closePath();
    //         context.fillStyle = color;
    //         context.stroke();
    //         context.fill();

    //         context.beginPath();

    //         context.strokeStyle = 'rgba(0, 220, 0,1)';
    //         context.moveTo(0, 0);
    //         context.lineTo(width, 0);
    //         context.lineTo(width, height);
    //         context.lineTo(0, height);
    //         context.closePath();
    //         context.stroke();

    //         return canvas;
    //     }
    //     var canvas = getCanvas('rgba(220, 220, 0,1)');
    //     // var canvas2 = getCanvas('rgba(0,220,220,1)');
    //     ctx.drawImage(canvas, x, y);

    //     ctx.beginPath();
    //     ctx.moveTo(x, y);
    //     ctx.arc(x, y, radius, start, end, false);
    //     ctx.closePath();

    //     ctx.fillStyle = cell.color;
    //     ctx.stroke();
    //     // ctx.fill();
    // },


    getCanvasCell: function(cell, color) {
        var canvas = document.createElement('canvas');
        var radius = this._cellRadius;
        canvas.width = canvas.height = (radius << 1);

        var ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(radius, radius);
        ctx.arc(radius, radius, radius, cell.startRadian, cell.endRadian, false);
        ctx.closePath();
        if (color)
            ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();

        return canvas;
    },

    drawCell: function(ctx, pts, cell) {
        var x = pts[0];
        var y = pts[1];

        var color = cell.cell_type == 2 ? BLUE : RED;

        if (this.drawCell2G == false && cell.cell_type == 2)
            return;
        if (this.drawCell3G == false && cell.cell_type == 3)
            return;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, this._cellRadius, cell.startRadian, cell.endRadian, false);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();

        if (this.showCellName) {
            // console.log(cell);
            var xt = this._cellRadius * Math.cos(cell.biRadian);
            var yt = this._cellRadius * Math.sin(cell.biRadian);

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

            // draw: function(topPointlatlng, WIDTH, HEIGHT, coords, img)
            // this.draw([cell.lat, cell.lng], this._cellRadius, this._cellRadius, coords, this.getCanvasCell(cell, RED));

        }
    },

});

L.TileLayer.maskCanvas = function(options) {
    return new L.TileLayer.MaskCanvas(options);
};
