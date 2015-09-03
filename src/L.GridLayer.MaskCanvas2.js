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
const NUMPOLYGON = 100;
const NUMBPOLYGON = 10;
const VPOLY = 1;
const BPOLY = 2;
const HUGETILE_THREADSHOLD = 5000;

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
        map: undefined,
        useGlobalData: false
    },

    ready: false,

    needPersistents: 0,

    prev: undefined,

    tiles: new lru(40),
    hugeTiles: new lru(40),
    emptyTiles: new lru(4000),

    canvases: new lru(100),

    // rtreeLCTilePoly: new lru(40),    
    BBAllPointLatlng: [-9999, -9999, -9999, -9999],
    initialize: function(options) {
        L.setOptions(this, options);
        var db = this.options.db;
        var self = this;
        if (db) {
            
            // var refreshDB = function(self) {
            //     db.destroy().then(function(response) {
            //         db = new PouchDB('vmts');
            //         console.log("Refresh database");                    
            //         self.ready = true;
            //     }).catch(function(err) {
            //         console.log(err);
            //     })
            // }

            // refreshDB(this);



            db.allDocs({
                include_docs: true,
                attachments: true
            }).then(function(result) {
                // handle result
                return Promise.all(result.rows.map(function(row) {
                    return db.remove(row.id, row.value.rev);
                })).then(function() {
                    self.ready = true;
                    console.log("Remove all temporary tiles");
                });

            }).catch(function(err) {
                console.log(err);
            });
        }
    },

    globalData: function() {
        this.options.useGlobalData = true;
    },

    localData: function() {
        this.options.useGlobalData = false;
    },

    getId: function(coords) {
        return coords.z + "_" + coords.x + "_" + coords.y;
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
        var id = this.getId(coords);
        var savedTile = this.hugeTiles.get(id) || this.tiles.get(id); //check if tile in lru mem cache

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

        var minXLatLng = 1000,
            minYLatLng = 1000,
            maxXLatLng = -1000,
            maxYLatLng = -1000;

        this._rtree = new rbush(32);

        var data = [];


        // var numPoints = dataset.length;
        var numPoints = 50000;
        for (var i = 0; i < numPoints; ++i) {
            var item = dataset[i];
            var x = item[0];
            var y = item[1];
            data.push([x, y, x, y, item, i]);
            if (x < minXLatLng) minXLatLng = x;
            if (y < minYLatLng) minYLatLng = y;
            if (x > maxXLatLng) maxXLatLng = x;
            if (y > maxYLatLng) maxYLatLng = y;
        }

        this.BBAllPointLatlng = [minXLatLng, minYLatLng, maxXLatLng, maxYLatLng];

        this._rtree.load(data);

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

    queryPointInTile: function(coords) {
        var tileSize = this.options.tileSize;
        var nwPoint = coords.multiplyBy(tileSize);
        var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

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

        return {
            'bb': bb,
            'pointCoordinates': pointCoordinates,
        }
    },

    getStoreTile: function(id) {

        return Promise.reject();
        // var tile = this.tiles.get(id);
        // return tile;
        var self = this;
        if (!this.ready) {
            console.log(this.ready);
            return Promise.reject("NOT READY")
        };

        var promise = new Promise(function(res, rej) {

            var db = self.options.db;

            db.get(id).then(function(doc) {

                console.log('doc:', doc);

                var blobURL = blobUtil.createObjectURL(doc.img);
                var newImg = new Image();
                newImg.src = blobURL;
                doc.img = newImg;
                res(doc);

            }).catch(function(err) {
                console.log('err', err);
                rej(err);
            });
        })

        return promise;
    },

    getTile: function(coords, canvas) {

        //1.kiem tra xem tile co duoc luu (trong RAM, o cung) khong
        //2.neu co tra ve tile ket thuc
        //3.neu chua co thuc hien buoc 4
        //4.tao tile
        //5.Cache tile (vao RAM hoac o cung)
        //6.tra ve tile va ket thuc        
        var self = this;
        var promise = new Promise(function(res, rej) {

            var id = self.getId(coords);

            var tile = self.getStoreTile(id).then(function(tile) {
                tile.here = "in mem";
                console.log(tile);
                res(tile);
            }).catch(function(err) {
                console.log('err2', err);
                var r = self.queryPointInTile(coords);

                var tile = {
                    '_id': id,
                    data: r.pointCoordinates,
                    bb: r.bb,
                    numPoints: r.pointCoordinates.length,
                    canvas: canvas,
                    img: undefined,
                };

                if (tile.numPoints > 0) {
                    if (!tile.img) {
                        self._drawPoints(canvas, coords, tile.data, false);
                        var img = new Image();
                        img.src = canvas.toDataURL("image/png");
                        tile.img = img;
                    }
                    // self.storeTile(id, tile);
                }

                res(tile);
            });

        });

        return promise;
    },

    storeTile: function(id, tile) {
        // this.tiles.set(id, tile);        
        var db = this.options.db;
        if (this.ready) {            
            this.backupToDb(db, tile);
        }
    },

    backupToDb: function(db, tile) {

        var simpleTile = {
            _id: tile._id,
            data: tile.data,
            bb: tile.bb,
            numPoints: tile.numPoints,
            img: undefined,
        }

        var self = this;

        db.upsert(simpleTile._id, function(doc) {
            return simpleTile;
        }).then(function(res) {

            return blobUtil.canvasToBlob(tile.canvas).then(function(blob) {
                console.log(blob);
                simpleTile.img = blob;

                // db.putAttachment(simpleTile._id, "imgage", res.rev, blob, 'image/png').then(function(result) {
                //     console.log('result', result);
                // }).catch(function(err) {
                //     console.log('err put attachments', err);
                // })

            });

        }).catch(function(err) {
            console.log('err upsert:', err);
        })
    },

    _draw: function(canvas, coords) {
        var id = this.getId(coords);
        this.canvases.set(id, canvas);

        //1.laytile
        //2.kiem tra xem tile co anh cua tile da tinh toan tu truoc khong
        //3.neu co ve lai anh len canvas va ket thuc
        //4.neu chua co ve toan bo diem tren canvas
        //5.luu lai anh canvas vao tile
        //6.ket thuc
        var self = this;
        var tile = this.getTile(coords, canvas).then(function(tile) {
            if (tile.img) {
                self.drawImage(canvas, tile.img, 0, 0);
            } else {
                if (tile.data.length > 0) {
                    self._drawPoints(canvas, coords, tile.data, false);
                }
            }
        }).catch(function(err) {

        });
    },

    drawImage: function(canvas, img, x, y) {
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, x, y);
    },

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

});

L.TileLayer.maskCanvas = function(options) {
    return new L.GridLayer.MaskCanvas(options);
};
