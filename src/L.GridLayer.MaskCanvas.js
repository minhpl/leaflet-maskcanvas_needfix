/**
 * This L.GridLayer.MaskCanvas plugin is for Leaflet 1.0
 * For Leaflet 0.7.x, please use L.TileLayer.MaskCanvas
 */

const LOADED = 1;
const LOADING = -1;
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
const RED = "rgba(255,0,0,0.2)"; //2G
const BLUE = "rgba(0,0,255,0.3)"; //3G
const TILESIZE = 256;
const CELLTYPE2G = 2;
const CELLTYPE3G = 3;
const HUGETILE_THREADSHOLD = 5000;

const EMPTY = {
    empty: true,
};


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
        db: new PouchDB('vmts'),
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
        hover_poly_color: 'rgba(200,0,0,0.3)',
        hover_cell_color: 'rgba(200,220,220,1)',
        bright_cell_color: 'rgba(255, 102, 204,1)',
        useStoreDB: true,
    },

    ready: false,
    rtree_loaded: false,

    needPersistents: 0,

    prev: undefined,

    tiles: new lru(40),
    hugeTiles: new lru(40),

    all_tiles_drawed: {},
    rtree_cachedTilePoly: rbush(32),
    rtree_cachedTileCell: rbush(32),

    tilesStoredNeedUpdate: {},

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

    globalData: function() {
        this.options.useGlobalData = true;
    },

    localData: function() {
        this.options.useGlobalData = false;
    },

    initialize: function(options) {
        L.Util.setOptions(this, options);
        this._rtreePolygon = new rbush(32);
        this._rtreeCell = new rbush(32);

        var _cellRadius = this.options._cellRadius;
        var db = this.options.db;

        var self = this;
        if (db) {
            var refreshDB = function() {
                db.destroy().then(function(response) {
                    self.options.db = new PouchDB('vmts');
                    console.log("Refresh database");
                    self.ready = true;
                }).catch(function(err) {
                    console.log(err);
                })
            }

            refreshDB(this);
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

            function getIntersectPoly(currentlatlng) {
                var rtree = self._rtreePolygon;
                if (rtree) {
                    var lat = currentlatlng.lat;
                    var lng = currentlatlng.lng;
                    var result = rtree.search([lat, lng, lat, lng]);

                    isInsidePoly = function(currentlatLng, vertexsL) {
                        var x = currentlatLng.lat,
                            y = currentlatLng.lng;

                        // var vertexsL = this.vertexsL;
                        var inside = false;
                        for (var i = 0, j = vertexsL.length - 1; i < vertexsL.length; j = i++) {
                            var xi = vertexsL[i].x,
                                yi = vertexsL[i].y;
                            var xj = vertexsL[j].x,
                                yj = vertexsL[j].y;

                            var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                            if (intersect) inside = !inside;
                        }

                        return inside;
                    }

                    if (result.length > 0) {
                        var polys = [];
                        var topPoly, id = -1;
                        for (var i = 0; i < result.length; i++) {
                            var r = result[i];
                            var poly = r[4];

                            if (isInsidePoly(currentLatLng, poly.vertexs)) {
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

            if (cell || poly) {
                $('.leaflet-container').css('cursor', 'pointer');

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

                if (poly && !cell) {
                    if (self.lastRecentInfo.polyID && (polys.topPolyID == self.lastRecentInfo.polyID)) {

                    } else {

                        if (self.lastRecentInfo.imgPolyCropped) {

                            self.redrawImgCropped(self.lastRecentInfo.imgPolyCropped);
                        }

                        self.lastRecentInfo.polyID = polys.topPolyID;
                        self.lastRecentInfo.poly = poly;

                        var canvas2 = self.getCanvasPoly(poly, coords, self.options.hover_poly_color);
                        var sizeWidth = poly.size[0];
                        var sizeHeigth = poly.size[1];
                        if (sizeWidth != 0 && sizeHeigth != 0) {
                            self.lastRecentInfo.imgPolyCropped = self.cropImgBoxsFromTL(poly.TL, poly.size[0], poly.size[1], coords);
                            self.drawFromTL(poly.TL, poly.size[0], poly.size[1], coords, canvas2);
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
                // image.draw();
                image.put();
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
                // console.log(imgData);
                ctx.putImageData(imgData, tilePoint[0] - w, tilePoint[1] - h);
            }
        }
    },


    drawFromTL: function(topLeftlatlng, WIDTH, HEIGHT, coords, img) {
        var lat = topLeftlatlng[0];
        var lng = topLeftlatlng[1];
        var topLeft = [lat, lng];

        var tlPointTile = this._tilePoint(coords, topLeft);

        var tileIDs = this.getTileIDsFromTL(tlPointTile, WIDTH, HEIGHT, coords);


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

    getTileIDsFromTL: function(tlPoint, WIDTH, HEIGHT, coords) {
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

    cropImage: function(canvas, centrePoint, WIDTH, HEIGHT) {
        var context = canvas.getContext('2d');
        w = WIDTH >> 1;
        h = HEIGHT >> 1;

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

        var width = maxX - minX;
        var height = maxY - minY;

        if (width == 0 || height == 0) {
            return new Image();
        }

        var subCanvas = document.createElement('canvas');
        subCanvas.width = width;
        subCanvas.height = height;
        var subContext = subCanvas.getContext('2d');

        // if (!canvas.imgData) {            
        var pix = context.getImageData(0, 0, TILESIZE, TILESIZE);
        canvas.imgData = new ImageBuffer(pix);
        // }

        var img = new Image();
        var imgData = subContext.createImageData(width, height);

        var buffer = new ImageBuffer(imgData);
        var color = {};
        var data = canvas.imgData;

        for (var y = 0; y < height; ++y) {
            for (var x = 0; x < width; ++x) {
                data.getPixelAt(x + minX, y + minY, color);
                buffer.setPixelAt(x, y, color.r, color.g, color.b, color.a);
            }
        }

        subContext.putImageData(imgData, 0, 0);
        return imgData;
    },

    cropImageFromTL: function(canvas, topLeft, WIDTH, HEIGHT) {
        var context = canvas.getContext('2d');

        var minX = topLeft[0];
        var minY = topLeft[1];

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

        var width = maxX - minX;
        var height = maxY - minY;

        if (width == 0 || height == 0) {
            return new Image();
        }

        var subCanvas = document.createElement('canvas');
        subCanvas.width = width;
        subCanvas.height = height;
        var subContext = subCanvas.getContext('2d');

        var pix = context.getImageData(0, 0, TILESIZE, TILESIZE);
        canvas.imgData = new ImageBuffer(pix);

        var img = new Image();
        var imgData = subContext.createImageData(width, height);

        var buffer = new ImageBuffer(imgData);
        var color = {};
        var data = canvas.imgData;

        for (var y = 0; y < height; ++y) {
            for (var x = 0; x < width; ++x) {
                data.getPixelAt(x + minX, y + minY, color);
                buffer.setPixelAt(x, y, color.r, color.g, color.b, color.a);
            }
        }

        subContext.putImageData(imgData, 0, 0);
        return imgData;
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
            // console.log("canvas", canvas._imgData);

            if (!canvas) {
                // console.log("No canvas ", tile);
                continue;
            }
            var coords = tile.coords;
            var tilePoint = this._tilePoint(coords, topPts);
            var imgData = this.cropImage(canvas, tilePoint, WIDTH, HEIGHT);

            var o = {};
            o.canvas = canvas;
            o.tilePoint = tilePoint;
            o.imgData = imgData;
            o.ctx = canvas.getContext('2d');

            o.put = function() {
                var minX = (this.tilePoint[0] - w);
                var minY = (this.tilePoint[1] - h);
                minX = (minX < 0) ? (minX - 0.5) >> 0 : (minX + 0.5) >> 0;
                minY = (minY < 0) ? (minY - 0.5) >> 0 : (minY + 0.5) >> 0;

                if (minX < 0)
                    minX = 0;

                if (minY < 0)
                    minY = 0;

                var self = this;
                // console.log(self.imgData);
                var putImageData = function() {
                    try {
                        self.ctx.putImageData(self.imgData, minX, minY);

                        // console.log("????????????", self.canvas._imgData);
                        self.ctx.putImageData(self.canvas._imgData, 0, 0);

                    } catch (e) {
                        // console.log("err put image data ", e);
                        setTimeout(putImageData, 10);
                    }
                }

                putImageData();
                // self.ctx.putImageData(self.imgData, minX, minY);
            }

            result.push(o);
        }
        return result;
    },

    cropImgBoxsFromTL: function(topLeftlatlng, WIDTH, HEIGHT, coords) {

        var lat = topLeftlatlng[0];
        var lng = topLeftlatlng[1];
        var nw = [lat, lng];

        var topLeft = this._tilePoint(coords, nw);
        var tileIDs = this.getTileIDsFromTL(topLeft, WIDTH, HEIGHT, coords);

        var result = [];

        var self2 = this;

        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];
            var canvas = tile.canvas;
            if (!canvas) {
                continue;
            }

            var coords = tile.coords;

            var tilePoint = this._tilePoint(coords, nw);

            var imgData = this.cropImageFromTL(canvas, tilePoint, WIDTH, HEIGHT);

            var o = {};
            o.canvas = canvas;
            o.tilePoint = tilePoint;
            o.imgData = imgData;
            o.ctx = canvas.getContext('2d');

            o.put = function() {
                var minX = this.tilePoint[0];
                var minY = this.tilePoint[1];
                if (minX < 0)
                    minX = 0;

                if (minY < 0)
                    minY = 0;

                var self = this;


                // self.ctx.putImageData(self.imgData, minX, minY);

                var putImageData = function() {
                    try {
                        self.ctx.putImageData(self.imgData, minX, minY);
                        self.ctx.putImageData(self.canvas._imgData, 0, 0);
                    } catch (e) {
                        console.log("err ", e);
                        setTimeout(putImageData, 10);
                    }
                }

                putImageData();
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

    makeDataPoly: function(dataPoly) {
        var id = 0;
        if (!dataPoly) {
            var dPoly = [];
            var maxWith = 0.0025674919142666397;
            var maxHeight = 0.0274658203125;

            for (j = 0; j < NUMPOLYGON; j++) {

                var lat = 21.00952219788383 + Math.random() * (21.056267652104697 - 21.00952219788383);
                var lng = 105.72898864746095 + Math.random() * (105.8020305633545 - 105.72898864746095);

                var polyVertex = makeVPolygon2(lat, lng, maxWith, maxHeight); //tao cac dinh cua polygon theo latlng
                polyVertex[0].c = 'rgba(0, 255, 0,0.3)';

                var poly = {};

                poly.vertexs = polyVertex;
                var minlat = 999,
                    minlng = 999,
                    maxlat = -999,
                    maxlng = -999;
                for (var i = 0; i < polyVertex.length; i++) {
                    var vertex = polyVertex[i];
                    if (minlat > vertex.x) {
                        minlat = vertex.x;
                    }

                    if (minlng > vertex.y) {
                        minlng = vertex.y;
                    }

                    if (maxlat < vertex.x) {
                        maxlat = vertex.x;
                    }

                    if (maxlng < vertex.y) {
                        maxlng = vertex.y;
                    }
                }

                poly.lBounds = [minlat, minlng, maxlat, maxlng];
                poly.posL = [(minlat + maxlat) / 2, (minlng + maxlng) / 2];

                poly.TL = [maxlat, minlng];

                var a = [minlat, minlng, maxlat, maxlng, poly, id++];
                dPoly.push(a);
            }
            return dPoly;
        } else {
            var dPoly = [];

            console.log("data from server length", dataPoly.length);

            for (var j = 0; j < dataPoly.length; j++) {
                var polyVertex = dataPoly[j];
                poly = {};

                poly.vertexs = polyVertex;

                var minlat = 999,
                    minlng = 999,
                    maxlat = -999,
                    maxlng = -999;
                for (var i = 0; i < polyVertex.length; i++) {
                    var vertex = polyVertex[i];
                    if (minlat > vertex.x) {
                        minlat = vertex.x;
                    }

                    if (minlng > vertex.y) {
                        minlng = vertex.y;
                    }

                    if (maxlat < vertex.x) {
                        maxlat = vertex.x;
                    }

                    if (maxlng < vertex.y) {
                        maxlng = vertex.y;
                    }
                }

                poly.lBounds = [minlat, minlng, maxlat, maxlng];
                poly.posL = [(minlat + maxlat) / 2, (minlng + maxlng) / 2];

                poly.TL = [maxlat, minlng];

                var a = [minlat, minlng, maxlat, maxlng, poly, id++];
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

    setDataPoly: function(dataPoly) {
        var self = this;

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

            var allTileNeedUpdate = this.rtree_cachedTilePoly.search(boundaryBox);
            for (var i = 0; i < allTileNeedUpdate.length; i++) {
                var id = allTileNeedUpdate[i][4];
                self.tilesStoredNeedUpdate[id] = true;
            }

            var items = this._rtreePolygon.search(boundaryBox);
            for (var i = 0; i < items; i++) {
                var item = items[i];
                this._rtreePolygon.remove(item);
            }
        } else {

            var allTileNeedUpdate = this.rtree_cachedTilePoly.all();
            for (var i = 0; i < allTileNeedUpdate.length; i++) {
                var id = allTileNeedUpdate[i][4];
                self.tilesStoredNeedUpdate[id] = true;
            }


            if (db) {
                var refreshDB = function() {
                    db.destroy().then(function(response) {
                        self.options.db = new PouchDB('vmts');
                        console.log("Refresh database");
                        self.ready = true;
                    }).catch(function(err) {
                        console.log(err);
                    })
                }

                refreshDB(this);
            }


            this._rtreePolygon.clear();
        }
        this._maxRadius = this.options.radius;
    },

    clearCell: function(boundaryBox) {
        if (boundaryBox) {

            var allTileNeedUpdate = this.rtree_cachedTileCell.search(boundaryBox);
            for (var i = 0; i < allTileNeedUpdate.length; i++) {
                var id = allTileNeedUpdate[i][4];
                self.tilesStoredNeedUpdate[id] = true;
            }

            var items = this._rtreeCell.search(boundaryBox);
            for (var i = 0; i < items; i++) {
                var item = items[i];
                this._rtreeCell.remove(item);
            }
        } else {

            var allTileNeedUpdate = this.rtree_cachedTile.all();
            for (var i = 0; i < allTileNeedUpdate.length; i++) {
                var id = allTileNeedUpdate[i][4];
                self.tilesStoredNeedUpdate[id] = true;
            }


            if (db) {
                var refreshDB = function() {
                    db.destroy().then(function(response) {
                        self.options.db = new PouchDB('vmts');
                        console.log("Refresh database");
                        self.ready = true;
                    }).catch(function(err) {
                        console.log(err);
                    })
                }

                refreshDB(this);
            }

            this._rtreeCell.clear();
        }
        this._maxRadius = this.options.radius;
    },

    addPolygonMarker: function(dataPoly) {
        if (this._rtreePolygon)
            this._rtreePolygon.load(this.makeDataPoly(dataPoly));
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

    /**
     * @param {HTMLCanvasElement|HTMLElement} canvas
     * @param {L.Point} coords
     * @private
     */

    queryPolys: function(coords) {
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
    },


    queryCells: function(coords) {
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
        return {
            cellCoordinates: cellCoordinates,
            bb: bb,
        }
    },

    getStoreObj: function(id) {

        if (!this.options.useStoreDB)
            return Promise.reject();

        if (this.tilesStoredNeedUpdate[id] == true) {
            console.log("need update tile in db", id);
            return Promise.reject();
        }

        /**
         * @ general description This function try to get tile from db,
         * if tile is founded, then it immediately set it up to lru head
         */
        self = this;

        var db = this.options.db;

        var promise = new Promise(function(res, rej) {
            if (!self.ready) { //need to wait for all old data be deleted
                rej("Not ready");
                return;
            }

            if (db) {
                // console.log("getStoreObj")
                db.get(id, {
                    attachments: false
                }).then(function(doc) {
                    if (self.options.debug) console.log("Found ------------------- ", doc._id, doc);
                    doc.needSave = false;

                    if (!doc.img && (doc.numCells > 0 || doc.numPolys > 0)) {
                        var blob = doc.image;
                        var blobURL = blobUtil.createObjectURL(blob);

                        var newImg = new Image();
                        newImg.src = blobURL;
                        doc.img = newImg;
                    }

                    // var nTile = self.tiles.get(id);
                    // if (!nTile || !nTile.img) {

                    if (doc.numCells == 0 && doc.numPolys == 0) {

                        // console.log("hrere", tile);
                        self.emptyTiles.set(id, EMPTY);
                        self.tiles.remove(id);
                        self.hugeTiles.remove(id);
                        res(EMPTY);

                        console.log("here", id);

                        return;
                    }

                    if ((doc.numCells > 0 || doc.numPolys > 0)) {

                        if (doc.numCells + doc.numPolys >= HUGETILE_THREADSHOLD) {
                            self.hugeTiles.set(id, doc);
                            self.tiles.remove(id);
                        } else {
                            self.store(id, doc);
                            self.hugeTiles.remove(id);
                        }
                    }


                    res(doc);
                }).catch(function(err) {
                    // console.log(err);
                    rej(err);
                });
            } else rej(new Error("No DB found"));
        });

        return promise;
    },

    getTile: function(coords) {
        /**

         * @general description: this function check if tile in cache (lru or db)
         * if tile is not founded, then we create tile data by RTREE, and then we cache this tile to lru immediately    
         */
        var self = this;
        var id = this.getId(coords);

        var tile;

        if (this.options.useStoreDB && !this.tilesStoredNeedUpdate[id]) {
            tile = this.tiles.get(id) || this.hugeTiles.get(id);
        }

        if (tile && tile.status != LOADING && this.options.useStoreDB) {
            if (self.options.debug)
                console.log("tile in mem", tile);
            return Promise.resolve(tile);
        }

        if (this.emptyTiles.get(id)) {
            if (self.options.debug)
                console.log("tile is empty", tile);
            return Promise.resolve(EMPTY);
        }

        if (!tile || tile.status != LOADING) {
            tile = {};
            tile.status = LOADING;
            self.store(id, tile);
            // console.log("here");
            var promise = new Promise(function(resolve, reject) {
                //sau do kiem tra trong o cung                
                var out = self.getStoreObj(id).then(function(res) {
                    if (self.options.debug)
                        console.log("tile in db", res);

                    self.store(id, res);
                    res.status = LOADED;
                    // console.log("here, found", res._id, res);
                    resolve(res);

                }, function(err) {

                    //neu trong o cung khong co thi lay trong RTREE         
                    //        
                    if (self.options.debug)
                        console.log("Err", id, err);

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

                    var bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z),
                        self._map.unproject(nwPoint, coords.z));

                    var currentBounds = self._boundsToQuery(bounds);
                    var bbPoly = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];

                    nwPoint = nwPoint.subtract(pad);
                    sePoint = sePoint.add(pad);

                    bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z),
                        self._map.unproject(nwPoint, coords.z));

                    currentBounds = self._boundsToQuery(bounds);
                    var bbCell = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];


                    //Create RTREE_cached
                    if (!self.all_tiles_drawed[id]) {
                        self.all_tiles_drawed[id] = {};
                        self.rtree_cachedTilePoly.insert([bbPoly[0], bbPoly[1], bbPoly[2], bbPoly[3], id]);
                        self.rtree_cachedTileCell.insert([bbCell[0], bbCell[1], bbCell[2], bbCell[3], id]);
                    } else {
                        console.log("all_tiles_drawed", self.all_tiles_drawed[id], self.all_tiles_drawed);
                    }


                    // var rqpoly = self.queryPolys(coords);
                    // var vpolyCoordinates = rqpoly.vpolyCoordinates;
                    // var bbpoly = rqpoly.bb;

                    // var rqcells = self.queryCells(coords);
                    // var cellCoordinates = rqcells.cellCoordinates;
                    // var bbCell = rqcells.bb;

                    // var numPolys = vpolyCoordinates.length;
                    // var numCells = cellCoordinates.length;

                    // console.log(rqpoly, rqcells, coords, numPolys, numCells);


                    var vpolyCoordinates = self.options.useGlobalData ? null : self._rtreePolygon.search(bbPoly);
                    if (vpolyCoordinates) {
                        vpolyCoordinates.sort(function(a, b) {
                            return a[5] - b[5];
                        })
                    }
                    var numPolys = vpolyCoordinates ? vpolyCoordinates.length : 0;
                    cellCoordinates = self.options.useGlobalData ? null : self._rtreeCell.search(bbCell);
                    if (cellCoordinates) {
                        cellCoordinates.sort(function(a, b) {
                            return a[5] - b[5];
                        })
                    }
                    var numCells = cellCoordinates ? cellCoordinates.length : 0;

                    tile = {
                        _id: id,
                        numCells: numCells,
                        numPolys: numPolys,
                        dataPolys: vpolyCoordinates,
                        dataCells: cellCoordinates,
                        bbPoly: bbPoly,
                        bbCell: bbCell,
                        cellRadius: self._cellRadius,
                        needSave: true,
                        status: LOADED,
                    };

                    if (self.tilesStoredNeedUpdate[id] == true) {
                        delete self.tilesStoredNeedUpdate[id];
                        console.log("updated tile", self.tilesStoredNeedUpdate[id], id);
                    }


                    if (self.options.debug)
                        console.log("create tile from rtree", tile);

                    if (!self.options.useGlobalData && tile.numCells == 0 && tile.numPolys == 0) {
                        // console.log("hrere", tile);
                        self.emptyTiles.set(id, EMPTY);
                        self.tiles.remove(id);
                        self.hugeTiles.remove(id);
                        resolve(EMPTY);
                        return;
                    }

                    if (!self.options.useGlobalData && (tile.numCells > 0 || tile.numPolys > 0)) {
                        self.emptyTiles.remove(id);
                        if (tile.numCells + tile.numPolys >= HUGETILE_THREADSHOLD) {
                            self.hugeTiles.set(id, tile);
                            self.tiles.remove(id, tile);
                        } else {
                            self.store(id, tile);
                            self.hugeTiles.remove(tile);
                        }
                    }

                    resolve(tile);
                })
            });
            return promise;
        }

        console.log("not return any thing");
        return Promise.reject();
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

        (function(self, canvas, coords) {
            var id = self.getId(coords);

            var ctx = canvas.getContext('2d');

            self.getTile(coords).then(function(tile) {

                // console.log("DrawTime", coords);
                // console.time(coords);

                // console.log("here", tile);
                if (tile.empty) {
                    return;
                }

                self._cellRadius = tile.cellRadius;

                if (tile.img) {
                    // console.log("here");                    
                    if (tile.img.complete) {
                        // if (tile.imgFromDB) {
                        //     ctx.drawImage(tile.img, 50, 50);
                        //     console.log("img from DB:", tile._id, " ctx.drawImage(tile.img, 50, 50)");
                        // } else
                        ctx.drawImage(tile.img, 0, 0);
                        // var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        // canvas._imgData = imgData;
                    } else {
                        tile.img.onload = function(e) {
                            if (e.target.complete) {
                                // if (tile.imgFromDB) {
                                //     ctx.drawImage(tile.img, 50, 50);
                                //     console.log("img from DB:", tile._id, " ctx.drawImage(tile.img, 50, 50)");
                                // } else
                                ctx.drawImage(tile.img, 0, 0);
                                console.log("image complete loaded");
                                var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                                canvas._imgData = imgData;
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
                                                // if (tile.imgFromDB) {
                                                //     ctx.drawImage(tile.img, 50, 50);
                                                //     console.log("img from DB:", tile._id, " ctx.drawImage(tile.img, 50, 50)");
                                                // } else
                                                ctx.drawImage(tile.img, 0, 0);
                                                console.log("retryLoadImage");
                                                var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                                                canvas._imgData = imgData;
                                            } else {
                                                retryLoadImage();
                                            }
                                        }
                                        countTimes++;
                                    }, 20);
                                };
                                retryLoadImage();
                            }
                        }
                    }
                    // console.log("here");

                    return;
                }

                if (!self.options.useGlobalData) {
                    self._drawVPolys(canvas, coords, tile.dataPolys);
                    self.drawCells(canvas, coords, tile.dataCells);
                } else {

                    var vpolyCoordinates = self._rtreePolygon.search(tile.bbPoly);
                    // console.log(vpolyCoordinates);

                    vpolyCoordinates.sort(function(a, b) {
                        return a[5] - b[5];
                    })

                    var numPolys = vpolyCoordinates.length;
                    cellCoordinates = self._rtreeCell.search(tile.bbCell);

                    cellCoordinates.sort(function(a, b) {
                        return a[5] - b[5];
                    })

                    var numCells = cellCoordinates.length;

                    tile.numPolys = numPolys;
                    tile.numCells = numCells;

                    // console.log("here", tile, self._rtreeCell);


                    if (numPolys > 0) {
                        self._drawVPolys(canvas, coords, vpolyCoordinates);
                    }
                    if (numCells > 0) {
                        self.drawCells(canvas, coords, cellCoordinates);
                    }
                }
                // this.drawCellName(canvas, coords, cells);

                if (tile.numCells > 0 || tile.numPolys > 0) {
                    // self.store(id, tile);                    

                    /**
                     * why don't use canvas directly instead of img ???                         
                     */
                    var img = new Image();
                    img.src = canvas.toDataURL("image/png");

                    // img.onload = function(){
                    // console.log("Store Img to tile");

                    //sau khi ve xong phai luu lai vao lru  hoac cache.
                    tile.img = img;

                    self.emptyTiles.remove(id);
                    if (tile.numCells + tile.numPolys >= HUGETILE_THREADSHOLD) {
                        // console.log(tile.img);
                        self.hugeTiles.set(id, tile);
                        self.tiles.remove(id);
                    } else {
                        self.store(id, tile);
                        self.hugeTiles.remove(id);
                    }

                } else {
                    console.log("detect empty tile here ________________________OMG");
                    self.emptyTiles.set(id, EMPTY);
                    self.hugeTiles.remove(id);
                    self.tiles.remove(id);
                }

                // console.timeEnd(coords);
            }).then(function() {
                // self._drawVPolys(canvas, coords, vpolyCoordinates);
                // console.time("getImageDataTime");

                // console.timeEnd("getImageDataTime");
                // console.log("canvas ...", canvas._imgData);
            }).catch(function(err) {
                console.log("Err", err);
            }).then(function() {
                // console.log("canvas imgData", id);
                var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                canvas._imgData = imgData;
            })
        })(self, canvas, coords);
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
                if (!self.options.useStoreDB) {
                    return;
                }

                {
                    var tile = removed;
                    if (tile.empty) {
                        console.log("detect empty tiles removed ________________________OMG");
                    } else if (tile.numCells + tile.numCells) {
                        console.log("detect hugeTiles removed ________________________OMG");
                    }
                }
                console.log("removed tile", removed.value.needSave, removed.value._id, removed.value);
                return self.backupToDb(self.options.db, removed.value);
            } else {
                // console.log("not removed", tile._id, tile);
                // return Promise.resolve();
            }
        });
        // })
    },

    backupToDb: function(db, tile) {

        if (this.options.debug)
            console.log("backupToDb", tile._id, tile);
        if (tile.needSave == false) {
            return;
        }

        var simpleTile = {
            _id: tile._id,
            numCells: tile.numCells,
            numPolys: tile.numPolys,
            dataCells: tile.dataCells,
            dataPolys: tile.dataPolys,
            status: tile.status,
            bbPoly: tile.bbPoly,
            bbCell: tile.bbCell,
            cellRadius: tile.cellRadius,
        }

        // console.log("here4", simpleTile, tile, simpleTile._id);

        var getBlob = function(tile) {
            // console.log("---------------------------");
            if (tile.img) {
                // console.log("IMG");
                return blobUtil.imgSrcToBlob(tile.img.src);
            } else if (tile.canvas) {
                // console.log("CANVAS");
                return blobUtil.canvasToBlob(tile.canvas);
            } else return Promise.reject("tile not containt img or canvas");
            // console.log("---------------------------");
        }

        var promise = new Promise(function(resolved, reject) {

            if (simpleTile.numCells > 0 || simpleTile.numPolys > 0) {

                // console.log(tile.img);
                getBlob(tile).then(function(blob) {

                    simpleTile.image = blob;

                    if (!self.worker) {

                        //********Web worker******
                        //**************************

                        /**
                         * I hope that operative will fallback to setTimeout in case of no web-worker support.
                         */

                        /**
                         * @description  web worker only see variable and function in worker scope (
                         * because web worker be written on individual blob or file), -> cannot see
                         * any variable or function in outer scope
                         *
                         *  but why if replace this by self, this code still work correct ? 
                         */

                        self.worker = operative({
                            db: undefined,

                            backup: function(simpleTile, callback) {

                                // console.log("in worker", simpleTile._id, simpleTile);

                                //Only need to create DB object only once
                                if (!this.db) {
                                    this.db = new PouchDB('vmts');
                                }

                                // console.log("in worker", simpleTile._id, simpleTile);

                                this.db.get(simpleTile._id).then(function(doc) {
                                    //doc._rev co khi len toi 3, tuc la da duoc update lai 3 lan
                                    // console.log(doc._rev, doc.needSave);
                                    simpleTile._rev = doc._rev;
                                    return this.db.put(simpleTile);
                                }).then(function() {
                                    callback(1);
                                    return this.db.get(simpleTile._id);
                                }).then(function(doc) {
                                    console.log("successfully update stored object: ", doc._id, doc);
                                }).catch(function(err) {
                                    if (err.status == 404) {
                                        this.db.put(simpleTile).then(function(res) {
                                            // console.log("in worker 2", simpleTile._id, simpleTile);
                                            console.log('successfully save new object ', simpleTile._id, res, simpleTile);
                                            callback(1);
                                        }).catch(function(err) {
                                            console.log('other err2', err, simpleTile);
                                            callback(undefined);
                                        });
                                    } else {
                                        console.log('other err1', err, simpleTile);
                                        callback(undefined);
                                    }
                                });
                            }
                        }, ['pouchdb-4.0.3.min.js', 'pouchdb.upsert.js']);
                    }

                    //********invoke web worker******
                    //*********************************
                    if (self.worker) {

                        // console.log("here", simpleTile);

                        self.worker.backup(simpleTile, function(results) {
                            if (results) {
                                // if (self.options.debug) console.log("Successfully update stored object: ", tile._id);
                                resolved();
                            } else {
                                console.log('err backupToDb', results);
                                reject();
                            }
                        })
                    }

                }).catch(function(err) {
                    console.log("cannot convert img or canvas to blob", err);
                    reject();
                })
            } else {
                resolve();
            }

        });

        // return promise;

        if (!self.prev) self.prev = Promise.resolve();
        self.prev = self.prev.then(function() {
            // console.log("before promise");
            return promise;
        }).catch(function(err) {
            console.log("Err", err);
        })
    },

    getCanvasPoly: function(vpoly, coords, fillColor) {

        // console.log("hehehehe 10_812_450");
        topLeft = this._tilePoint(coords, vpoly.TL);
        var minlat = vpoly.lBounds[0]
        var maxlng = vpoly.lBounds[3];
        var bottomRight = this._tilePoint(coords, [minlat, maxlng]);

        var width = bottomRight[0] - topLeft[0];
        var height = bottomRight[1] - topLeft[1];

        var canvas = document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;

        var subctx = canvas.getContext('2d');
        subctx.fillStyle = fillColor;

        subctx.translate(-topLeft[0], -topLeft[1]);

        var vertexs = vpoly.vertexs;
        var v0 = vertexs[0];
        var p0 = this._tilePoint(coords, [v0.x, v0.y]);

        subctx.moveTo(p0[0], p0[1]);

        for (var i = 1; i < vertexs.length; i++) {
            var vi = vertexs[i];
            var pi = this._tilePoint(coords, [vi.x, vi.y]);
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
        topLeft = this._tilePoint(coords, poly.TL);
        canvas = this.getCanvasPoly(poly, coords, poly.vertexs[0].c);

        if (canvas.width != 0 && canvas.height != 0) {
            ctx.drawImage(canvas, topLeft[0], topLeft[1]);
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
        // ctx.stroke();

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
            this.drawCell(ctx, pos, cell);
        }
    },

});

L.TileLayer.maskCanvas = function(options) {
    return new L.TileLayer.MaskCanvas(options);
};
