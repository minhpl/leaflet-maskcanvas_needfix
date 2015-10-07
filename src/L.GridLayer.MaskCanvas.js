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
const TILESIZE = 256;

L.GridLayer.MaskCanvas = L.GridLayer.extend({
    options: {
        db: new PouchDB('vmts', {
            auto_compaction: true
        }),
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
        useGlobalData: false,
        log: false,
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

    tilesInDBNeedUpdate: {},

    // rtreeLCTilePoly: new lru(40),    
    BBAllPointLatlng: [-9999, -9999, -9999, -9999],

    /**
     * [updateCachedTile description]
     * @param  {[type]} coords   [description]
     * @param  {[type]} numPoint [description]
     * @return {[type]}          [description]
     */

    initialize: function(options) {
        L.setOptions(this, options);
        var db = this.options.db;
        var self = this;
        if (db) {

            var refreshDB = function(self) {
                db.destroy().then(function(response) {
                    self.options.db = new PouchDB('vmts', {
                        auto_compaction: true
                    });
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

    getVertexAndBoundinLatLng: function(poly) {
        var map = this.options.map;
        var zoom = 12; //map.getZoom();
        // console.log("zoom", zoom);

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

    makeDataPoly: function() {
        var dlength = dataset.length;
        var interval = (dlength / NUMPOLYGON) >> 0;
        // console.log("interval ", interval);
        var dPoly = [];
        var id = 0;
        var maxWith = 0.0025674919142666397;
        var maxHeight = 0.0274658203125;

        // var canvas = document.getElementById('myCanvas');
        // var ctx = canvas.getContext('2d');
        // ctx.fillStyle = 'rgba(20,250,200,0.1)';

        for (var i = 0, j = 0; i < dlength && j < NUMPOLYGON; i += interval, j++) {
            // 20.9204, 105.59578
            // 21.11269, 105.88451

            // 21.15176, 105.65826
            // 20.76831, 105.25108
            var lat = 20.76831 + Math.random() * (21.15176 - 20.76831);
            var lng = 105.25108 + Math.random() * (105.65826 - 105.25108);

            var poly = makeVPolygon2(lat, lng, maxWith, maxHeight); //tao hinh dang cua polygon                        

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
    },

    makeRtree: function() {
        var self = this;

        var promise = new Promise(function(res, rej) {

            var craziness = operative({
                doCrazy: function(rtree_loaded) {
                    var deferred = this.deferred();
                    if (!rtree_loaded) {
                        // console.time('send');

                        var minXLatLng = 1000,
                            minYLatLng = 1000,
                            maxXLatLng = -1000,
                            maxYLatLng = -1000;
                        var buffer = new ArrayBuffer(8 * dataset.length * 2);
                        var arr = new Float64Array(buffer, 0);
                        var j = 0;
                        for (var i = 0; i < dataset.length; ++i) {
                            var item = dataset[i];
                            var x = item[0];
                            var y = item[1];

                            arr[j] = x;
                            arr[++j] = y;
                            ++j;

                            if (x < minXLatLng) minXLatLng = x;
                            if (y < minYLatLng) minYLatLng = y;
                            if (x > maxXLatLng) maxXLatLng = x;
                            if (y > maxYLatLng) maxYLatLng = y;
                        }
                        var BBAllPointLatlng = [minXLatLng, minYLatLng, maxXLatLng, maxYLatLng];

                        deferred.fulfill({
                            'buffer': buffer,
                            'bb': BBAllPointLatlng
                        }, [buffer]);

                        // console.timeEnd('send');
                    } else {
                        deferred.fulfill(undefined);
                    }
                }
            }, ['data-light.js']);

            craziness.doCrazy(self.rtree_loaded).then(function(result) {
                if (!self.rtree_loaded && result) {
                    var buffer = result.buffer;
                    var data = [];
                    var arr = new Float64Array(buffer, 0);
                    var j = 0;
                    for (var i = 0; i < arr.length; i += 2) {
                        var x = arr[i];
                        var y = arr[i + 1];
                        var item = [x, y];
                        data.push([x, y, x, y, item, j++]);
                    }
                    self._rtree.clear().load(data);
                    self.rtree_loaded = true;
                    self.BBAllPointLatlng = result.bb;
                    res();
                    craziness.terminate();
                } else {
                    reject();
                }
            });
        });

        return promise;
    },

    setData: function(dataset) {
        var self = this;
        this.bounds = new L.LatLngBounds(dataset);

        this._rtree = new rbush(32);
        this.rtree_loaded = false;

        this.makeRtree(self.rtree_loaded).then(function(res) {
            // console.log(res);
            if (self._map) {
                self.redraw();
                // console.log("redraw", self.rtree_loaded);
            }
            // console.log(self.rtree_loaded);
        }).catch(function(err) {
            console.log(err);
        })


        this._rtreePolygon = new rbush(32);
        this._rtreePolygon.load(this.makeDataPoly());

        this._maxRadius = this.options.radius;

    },

    //important function
    getStoreObj: function(id) {

        /**
         * @ general description This function try to get tile from db,
         * if tile is founded, then it immediately set it up to lru head
         */

        if (this.tilesInDBNeedUpdate[id] == true) {
            // console.log("needUpdate getStoreObj", id);
            return Promise.reject();
        }

        var db = this.options.db;

        var self = this;
        var promise = new Promise(function(res, rej) {
            if (!self.ready) { //need to wait for all old data be deleted
                rej("Not ready");
                return;
            }

            if (db) {
                db.get(id, {
                    attachments: false
                }).then(function(doc) {
                    if (self.options.debug) console.log("Found ------------------- ", doc._id, doc);
                    // var tile = {
                    //     _id: doc._id,
                    //     status : LOADED,
                    //     data: doc.data,
                    //     bb: doc.bb,
                    //     _rev : doc._rev,
                    //     needSave: false
                    // };
                    // var id = doc._id;

                    doc.status = LOADED;
                    doc.needSave = false;
                    if (!doc.img && doc.numPoints > 0) {
                        var blob = doc.image;
                        var blobURL = blobUtil.createObjectURL(blob);

                        var newImg = new Image();
                        newImg.src = blobURL;
                        doc.img = newImg;
                        doc.imgFromDB = true;
                        // setTimeout(function() {                            
                        //     var canvas = self.canvases.get(id);
                        //     var ctx = canvas.getContext('2d');
                        //     ctx.drawImage(newImg, -100, -100);                        
                        // }, 300);
                        if (doc.numPoints < HUGETILE_THREADSHOLD) {
                            var nTile = self.tiles.get(id);
                            if (!nTile || !nTile.img)
                                self.store(id, doc);
                        } else {
                            var nTile = self.hugeTiles.get(id);
                            if (!nTile || !nTile.img)
                                self.hugeTiles.set(id, doc);
                        }
                    }
                    // resolve(res);  
                    res(doc);
                }).catch(function(err) {
                    // console.log(err);
                    rej(err);
                });
            } else rej(new Error("No DB found"));
        });

        return promise;
    },

    all_tiles_id: new lru(4000),

    //important function
    getTile: function(coords) {
        /**

         * @general description: this function check if tile in cache (lru or db)
         * if tile is not founded, then we create tile data by RTREE, and then we cache this tile to lru immediately    
         */
        var id = coords.z + "_" + coords.x + "_" + coords.y;

        var valid = this.iscollides(coords);
        //Dau tien kiem tra tile trong bo nho RAM

        var tile = this.hugeTiles.get(id) || this.tiles.get(id);
        var self = this;
        // if (tile) console.log("Status ",tile.status);

        if (!self.rtree_loaded) {
            return Promise.reject();
        }

        // if not found
        if (!tile || tile.status == UNLOAD) {
            //use empty tiles( save almost empty tile) to prevent find empty tile in dabase many time, because
            //query data in db is time comsuming , so we check if tile is empty by query it in memory first.

            if (self.emptyTiles.get(id))
                return Promise.resolve(EMPTY);

            if (!tile) {
                tile = {};
            }

            tile.status = LOADING;

            self.store(id, tile);

            var promise = new Promise(function(resolve, reject) {
                //sau do kiem tra trong o cung                
                var out = self.getStoreObj(id).then(function(res) {

                    self.store(id, res);
                    res.status = LOADED;

                    if (res.numPoints == 0) {
                        self.emptyTiles.set(id, {});
                        self.tiles.remove(id);
                        if (self.needPersistents > self.tiles.size)
                            self.needPersistents--;
                        // console.log("Store empty tile ", self.emptyTiles.size);
                    }

                    resolve(res);

                }, function(err) {
                    //neu trong o cung khong co thi lay trong RTREE         
                    //                             

                    var tileSize = self.options.tileSize;
                    var nwPoint = coords.multiplyBy(tileSize);
                    var sePoint = nwPoint.add(new L.Point(tileSize, tileSize));

                    if (self.options.useAbsoluteRadius) {
                        var centerPoint = nwPoint.add(new L.Point(tileSize / 2, tileSize / 2));
                        self._latLng = self._map.unproject(centerPoint, coords.z);
                    }

                    // padding
                    var pad = new L.Point(self._getMaxRadius(coords.z), self._getMaxRadius(coords.z));
                    nwPoint = nwPoint.subtract(pad);
                    sePoint = sePoint.add(pad);

                    var bounds = new L.LatLngBounds(self._map.unproject(sePoint, coords.z),
                        self._map.unproject(nwPoint, coords.z));

                    var currentBounds = self._boundsToQuery(bounds);
                    var bb = [currentBounds.y, currentBounds.x, currentBounds.y + currentBounds.height, currentBounds.x + currentBounds.width];

                    var pointCoordinates = (self.options.useGlobalData) ? null : self._rtree.search(bb);

                    // if (err == "needUpdate")
                    //     console.log("needUpdate", pointCoordinates);

                    //Create RTREE_cached
                    if (!self.all_tiles_id.get(id)) {
                        self.all_tiles_id.set(id, {});
                        self.rtree_cachedTile.insert([bb[0], bb[1], bb[2], bb[3], id]);
                    }


                    if (pointCoordinates && pointCoordinates.length === 0) {

                        // console.log("here");

                        // console.log("Store empty tile ", self.emptyTiles.size);

                        self.emptyTiles.set(id, {});

                        self.tiles.remove(id);
                        if (self.needPersistents > self.tiles.size)
                            self.needPersistents--;
                        // console.log("Remove empty tile from current saved tiles",self.tiles.size);
                        resolve(EMPTY);
                        return;

                    }

                    var numPoints = (pointCoordinates) ? pointCoordinates.length : 0;

                    tile = {
                        _id: id,
                        numPoints: numPoints,
                        data: pointCoordinates,
                        bb: bb,
                        status: LOADED,
                        needSave: true,
                        neverSavedDB: true,
                    }

                    // if (err == "needUpdate")
                    // console.log("needUpdate numPoints", tile._id, tile.numPoints, self.tilesInDBNeedUpdate[id] == true);

                    if (self.tilesInDBNeedUpdate[id] == true) {
                        // console.log("-------------------------");
                        delete self.tilesInDBNeedUpdate[id];
                        console.log("delete", self.tilesInDBNeedUpdate[id], id);
                    }

                    // console.log("in here 7", tile);
                    //after create tile with RTREE, we save it down to lru cache and db immediately/

                    if (numPoints >= HUGETILE_THREADSHOLD) {
                        // console.log("here1");
                        var nTile = self.hugeTiles.get(id);

                        if (!nTile || nTile.status != LOADED) {
                            self.hugeTiles.set(id, tile);
                            self.tiles.remove(id);
                            resolve(tile);
                        } else resolve(nTile);

                    } else {
                        var nTile = self.tiles.get(id);

                        if (!nTile || nTile.status != LOADED) {
                            self.store(id, tile);
                            resolve(tile);
                        } else resolve(nTile);
                    }
                })
            });

            return promise;
        }

        tile.needSave = (tile.status == LOADED) ? false : true;
        if (tile.neverSavedDB) tile.needSave = true;
        // console.log("get tile", tile);
        return Promise.resolve(tile);
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

    timeoutId: undefined,

    //important function
    backupOne: function() {
        //this function is excute after mouse cursor stop moving by 0ms

        var self = this;

        if (this.timeoutId) clearTimeout(this.timeoutId);

        this.timeoutId = setTimeout(function() {
            // console.log("here");
            this.timeoutId = 0;
            var db = self.options.db;
            if (db && self.needPersistents > 0) {

                var node = self.tiles.head;
                while (node) {
                    var value = node.value;
                    if (value.needSave) {
                        self.backupToDb(db, value);
                        console.log("Backup once ", value);
                        break;
                    }
                    node = node.next;
                }
                self.needPersistents--;
            }
        }, 0);

    },

    worker: undefined,


    //important function
    backupToDb: function(db, tile) {

        if (tile.needSave && tile.status == LOADED && !tile.empty) {
            var self = this;
            tile.needSave = false; // change needSave field = false, so we know to don't duplicate save the same tile to db in later
            // console.log("Remove from memory 22, backup to DB ", tile);
            // var db = self.options.db;
            if (db) {

                var promise2 = new Promise(function(resolve2, reject2) {
                    var resolved2 = false;

                    // console.log('Back up to DB',db);
                    if (self.needPersistents > 0) self.needPersistents--;
                    // function retryUntilWritten(id, name, rev, blob, type, callback) {

                    var simpleTile = {
                        _id: tile._id,
                        numPoints: tile.numPoints,
                        data: self.options.useGlobalData ? undefined : tile.data,
                        bb: tile.bb,
                        status: LOADED,
                        needSave: false
                    }

                    if (self.options.useGlobalData) {
                        delete simpleTile.data;
                        delete simpleTile.sorted;
                    }

                    // if (tile._id == "10_813_451")
                    // console.log("in here5");


                    var getBlob = function(tile) {
                        // console.log("---------------------------");
                        if (tile.img) {
                            // console.log("IMG");
                            return blobUtil.imgSrcToBlob(tile.img.src);
                        } else if (tile.canvas) {
                            // console.log("CANVAS");
                            return blobUtil.canvasToBlob(tile.canvas);
                        } else return Promise.resolve();
                        // console.log("---------------------------");
                    }

                    var promise = new Promise(function(resolved, reject) {
                        if (tile.numPoints > 0 && (tile.canvas || tile.img)) {
                            getBlob(tile).then(function(blob) {

                                // if (tile._id == "10_813_451")
                                //     console.log("in here4");

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

                                            //Only need to create DB object only once
                                            if (!this.db) {
                                                this.db = new PouchDB('vmts', {
                                                    auto_compaction: true
                                                });
                                            }

                                            this.db.get(simpleTile._id).then(function(doc) {
                                                    //doc._rev co khi len toi 3, tuc la da duoc update lai 3 lan
                                                    // console.log(doc._rev, doc.needSave);
                                                    simpleTile._rev = doc._rev;
                                                    return this.db.put(simpleTile);
                                                })
                                                .then(function() {
                                                    callback('ok');
                                                    return this.db.get(simpleTile._id);
                                                }).then(function(doc) {
                                                    console.log("successfully update stored object: ", doc._id, doc);
                                                })
                                                .catch(function(err) {
                                                    if (err.status == 404) {
                                                        this.db.put(simpleTile).then(function(res) {
                                                            console.log('successfully save new object ', simpleTile._id, res);
                                                            callback('ok');
                                                        }).catch(function(err) {
                                                            console.log('other err2');
                                                            callback(undefined);
                                                        });
                                                    } else {
                                                        console.log('other err1');
                                                        callback(undefined);
                                                    }
                                                });
                                        }
                                    }, ['pouchdb-4.0.3.min.js', 'pouchdb.upsert.js']);
                                }

                                //********invoke web worker******
                                //*********************************
                                if (self.worker) {
                                    self.worker.backup(simpleTile, function(results) {
                                        if (results) {
                                            // if (self.options.debug) console.log("Successfully update stored object: ", tile._id);
                                            resolved();
                                        } else {
                                            console.log('err');
                                            reject();
                                        }
                                    })
                                }

                            }).catch(function(err) {
                                // console.log("cannot convert img or canvas to blob", err);
                                reject();
                            })
                        } else {
                            // console.log("in here3", tile);
                            resolved();
                        }
                    });

                    if (!self.prev) self.prev = Promise.resolve();
                    self.prev = self.prev.then(function() {
                        // console.log("before promise");
                        return promise;
                    }).then(function(response) {
                        // console.log("after promise");
                        if (!resolved2) {
                            // console.log("here");
                            resolve2();
                            resolved2 = true;
                        }
                    }).catch(function(err) {
                        // console.log("Err", err);
                        reject2();
                    });

                });

                return promise2;
            }
        }


        return Promise.resolve();
    },

    //important function
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
                console.log("removed tile", removed.value.needSave, removed.value._id, removed.value);
                return self.backupToDb(self.options.db, removed.value);
            } else {
                // console.log("not removed", tile._id, tile);
                return Promise.resolve();
            }
        });
        // })
    },

    /**
     * @param {HTMLCanvasElement|HTMLElement} canvas
     * @param {L.Point} coords
     * @private
     */

    //important function
    _draw: function(canvas, coords) {
        // var valid = this.iscollides(coords);
        // if (!valid) return;         

        if (!this._rtree || !this._map) {
            return;
        }

        var id = this.getId(coords);

        var self = this;

        var queryPolys = function(coords, self) {
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

        var id = this.getId(coords);

        this.canvases.set(id, canvas, function(removed, keyadd) {
            // console.log("add:", "removed: ",removed.key);
        });

        (function(self, canvas, coords) {
            var id = self.getId(coords);
            self.getTile(coords).then(function(tile) {

                // if (self.rtree_loaded)
                // console.log("getitles 2", tile);

                if (!tile || tile.status == LOADING || tile.empty) {

                    if (self.rtree_loaded)
                        return;
                }

                var ctx = canvas.getContext('2d');
                if (tile) {
                    // if (!tile.canvas) {
                    tile.canvas = canvas;
                    // self.store(id, tile);
                    // }                    
                    if (tile.img) { //if tile containt img rendered in early, draw img and return
                        // console.log("Draw from saved tile ",tile);
                        // var nw = self._tilePoint(coords,tile.bb);
                        // console.log("Draw at ",tile.bb,nw);                      

                        // console.log("sorted = ",tile.sorted);
                        if (tile.img.complete) {
                            // if (tile.imgFromDB) {
                            //     ctx.drawImage(tile.img, 50, 50);
                            //     console.log("img from DB:", tile._id, " ctx.drawImage(tile.img, 50, 50)");
                            // } else
                            ctx.drawImage(tile.img, 0, 0);
                        } else {
                            tile.img.onload = function(e) {
                                if (e.target.complete) {
                                    // if (tile.imgFromDB) {
                                    //     ctx.drawImage(tile.img, 50, 50);
                                    //     console.log("img from DB:", tile._id, " ctx.drawImage(tile.img, 50, 50)");
                                    // } else
                                    ctx.drawImage(tile.img, 0, 0);
                                    console.log("image complete loaded");
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
                        return;
                    }

                    if (!tile.data && self.options.useGlobalData) {
                        var data = self._rtree.search(tile.bb);
                        tile.numPoints = data.length;
                        // console.log("TILE + ",tile);
                        if (tile.numPoints > 0) {
                            self._drawPoints(canvas, coords, data, false);
                        } else {
                            if (self.rtree_loaded) {
                                // console.log("Store empty tile ", self.emptyTiles.size);
                                /**                            
                                 * @description if rtree_loaded = false, because rtree_loaded in asynchronous manner,
                                 * so data have not been loaded in tile.
                                 * and we cannot store tile to empty tile                                
                                 */

                                self.emptyTiles.set(id, {});
                                self.tiles.remove(id);
                                if (self.needPersistents > self.tiles.size)
                                    self.needPersistents--;
                                // console.log("Remove empty tile from current saved tiles",self.tiles.size);                                                                                       
                            }
                        }
                    } else {
                        self._drawPoints(canvas, coords, tile.data, tile.sorted);
                    }
                    tile.sorted = true;

                    if (tile.numPoints > 0) {
                        /**
                         * why don't use canvas directly instead of img ???                         
                         */
                        var img = new Image();
                        img.src = canvas.toDataURL("image/png");

                        // img.onload = function(){
                        // console.log("Store Img to tile");

                        //sau khi ve xong phai luu lai vao lru  hoac cache.
                        var nTile = self.tiles.get(id);
                        if (!nTile || !nTile.img) { // neu khong co tile hoac tile khong chua img
                            tile.img = img;

                            if (tile.numPoints >= HUGETILE_THREADSHOLD) {
                                self.hugeTiles.set(id, tile);
                                tile.needSave = false; //hugetile don't need to save to db.
                            } else self.store(id, tile);

                            if (tile.needSave) {
                                self.needPersistents++;
                                // console.log("Need persistent ",self.needPersistents,self.tiles.size);
                            }

                        } else {
                            //never called                    
                            console.log("OMG_________________________________________________________OMG");

                            nTile.canvas = canvas;
                            /**
                             * why needSave = false ?                             
                             */
                            ntile.needSave = false;
                            if (tile.numPoints >= HUGETILE_THREADSHOLD) {
                                self.hugeTiles.set(id, nTile);
                            } else self.store(id, nTile);
                        }
                        // };
                    }
                }
            }).then(function() {
                self._drawVPolys(canvas, coords, vpolyCoordinates);
            }).catch(function(err) {
                // console.log("here", err);
                // self.drawLinhTinh(canvas, coords, vpolyCoordinates);
            })
        })(self, canvas, coords);
        // console.log(tile,id);
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
            var w = this.options.radius;
            var h = this.options.radius;
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

    // drawVPoly: function(poly, canvas, coords) {
    //     var vertexsL = poly.vertexsL;

    //     var v0 = vertexsL[0];
    //     var p0 = this._tilePoint(coords, [v0.lat, v0.lng]);
    //     console.log("here", p0);

    // },

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
        // console.log(id);

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
    },

    alpha: function(point, canvas) {

        if (!canvas) {
            return -1;
        }

        var context = canvas.getContext('2d');

        var buffer;

        if (!canvas.imgData) {
            // console.log("Create new ImageData");
            var pix = context.getImageData(0, 0, TILESIZE, TILESIZE);
            canvas.imgData = new ImageBuffer(pix);
            buffer = canvas.imgData
        } else {
            buffer = canvas.imgData;
        }

        var x = (point.x + 0.5) >> 0;
        var y = (point.y + 0.5) >> 0;

        var i = ~~(x + (y * TILESIZE)); //floor()
        var location = (i << 2) + 3;

        var alph = buffer.uint8[location];

        return (!alph) ? -1 : alph;
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

    getID: function(zoom, x, y) {
        var _x = x < 0 ? 0 : x;
        var _y = y < 0 ? 0 : y;
        var result = {};

        result.id = zoom + "_" + _x + "_" + _y;
        result.coords = L.point(_x, _y);
        result.coords.zoom = zoom;
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

    getTileIDs: function(centrePoint, WIDTH, HEIGHT, coords) {
        // var TopPoint = info.topPointTile;
        // console.log("--------",info)
        var radius = this.options.radius >> 1;
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

    // popup: L.popup(),

    // i: 0,

    lastRecent: {},
    lastRecentInfo: {},


    getInfo: function(e) {
        // calulate ID
        var map = this.options.map;

        var currentlatlng = e.latlng;
        var currentPoint = map.project(currentlatlng);

        var x = (currentPoint.x / TILESIZE) >> 0;
        var y = (currentPoint.y / TILESIZE) >> 0;
        var zoom = map.getZoom();
        //
        var tileID = zoom + "_" + x + "_" + y;

        //get tile

        //calculate Point relative to Tile
        var tileTop = x * TILESIZE;
        var tileLeft = y * TILESIZE;
        var point = L.point(tileTop, tileLeft);
        var coords = L.point(x, y);
        coords.z = zoom;
        var tilePoint = this._tilePoint(coords, [currentlatlng.lat, currentlatlng.lng]);
        //
        tilePoint = L.point(tilePoint[0], tilePoint[1]);
        var result = {};

        var intersectPolys = this.getIntersectPoly(currentlatlng);
        result.intersectPolys = intersectPolys;
        // calculate alpha


        var tile = this.tiles.get(tileID) || this.hugeTiles.get(tileID);
        // var alph = (tile) ? alpha(tilePoint, tile.canvas) : -1;

        var alph = this.alpha(tilePoint, this.canvases.get(tileID));

        //calculate points and top point.
        var pointslatlng = this.circleCentrePointCover(currentPoint);
        //calculate TopPoints
        // if(pointslatlng.length!=0){}
        var topPointlatlng = this.getTopPoint(pointslatlng);
        var topPointTile;
        var topCircleID;
        if (topPointlatlng) {
            topPointTile = coverageLayer._tilePoint(coords, [topPointlatlng[0], topPointlatlng[1]]);
            topCircleID = topPointlatlng[5];
        }

        // var topPoint = getTopPoint(points);                
        result.tileIDX = x;
        result.tileIDY = y;
        result.tileIDZoom = zoom;
        result.tileID = tileID;
        result.coords = coords;
        result.tile = tile;
        result.tilePoint = tilePoint; //current point relative with tile
        result.alpha = alph;
        result.pointslatlng = pointslatlng; //[]

        result.topPointlatlng = topPointlatlng; //[lat,lng,lat,lng,item,id] or undefined
        result.topCircleID = topCircleID; //id of top points or undefined        
        result.topPointTile = topPointTile; //top points relative with tile, [x,y,z]

        return result;
    },

    draw: function(topPointlatlng, WIDTH, HEIGHT, coords, img) {
        var w = WIDTH >> 1;
        var h = HEIGHT >> 1;
        var lat = topPointlatlng[0];
        var lng = topPointlatlng[1];
        var topPts = [lat, lng];

        // var WIDTH,HEIGHT;
        // WIDTH = HEIGHT = coverageLayer.options.radius;

        var topPointTile = this._tilePoint(coords, topPts);

        var tileIDs = this.getTileIDs(topPointTile, WIDTH, HEIGHT, coords);

        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];
            var canvas = tile.canvas;
            var coords = tile.coords;
            var tilePoint = this._tilePoint(coords, topPts);
            if (canvas) {
                var ctx = canvas.getContext('2d');
                // img.onload= function(){
                drawImage(ctx, img, tilePoint[0] - w, tilePoint[1] - h);
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

        var tileIDs = this.getTileIDs(topPointTile, WIDTH, HEIGHT, coords);

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

    redrawFn: function(imgs) {
        for (var i = 0; i < imgs.length; i++) {
            var image = imgs[i];
            image.draw();
        }
    },

    drawImage: function(ctx, image, x, y) {
        function f() {
            drawImage(ctx, image, x, y);
        }
        try {
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
                    drawImage(self.ctx, self.img, minX, minY);
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
                                            drawImage(self.ctx, self.img, minX, minY);
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

    squaredistance: function(point1, point2) {
        return (point1.x - point2.x) * (point1.x - point2.x) + (point1.y - point2.y) * (point1.y - point2.y);
    },

    circleCentrePointCover: function(currentPositionPoint) {
        var rtree = this._rtree;

        var radius = this.options.radius;
        var map = this.options.map;

        var topLeft = currentPositionPoint.subtract(L.point(radius, radius));
        var nw = map.unproject(topLeft);
        var bottemRight = currentPositionPoint.add(L.point(radius, radius));
        var se = map.unproject(bottemRight);

        var box = [se.lat, nw.lng, nw.lat, se.lng];

        var result = rtree.search(box);

        var a = [];
        var radius = this.options.radius / 2;
        for (var i = 0; i < result.length; i++) {
            var r = result[i];
            var latLng = L.latLng(r[0], r[1]);
            var point = map.project(latLng);

            if (this.squaredistance(currentPositionPoint, point) <= radius * radius) {
                a.push(r);
            }
        }
        return a;
    },

    getTopPoint: function(Points) {
        var maxId = -1;
        var TopPoint;
        for (var i = 0; i < Points.length; i++) {
            var p = Points[i];
            if (p[5] > maxId) {
                maxId = p[5];
                TopPoint = p;
            }
        }

        if (TopPoint)
            TopPoint.id = maxId;

        return TopPoint;
    },

    getIntersectPoly: function(currentlatlng, tileID) {
        var rtree = this._rtreePolygon;
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
    },


    count: 0,

    insidePoly: false,

    timeoutID: undefined,


    onMouseMove: function(e) {
        if (this.timeoutID) clearTimeout(this.timeoutID);
        var self = this;

        this.timeoutID = setTimeout(function() {
            self.timeoutID = 0;

            self.backupOne();

            var info = self.getInfo(e);
            var radius = self.options.radius;

            insidePoly = false;

            if (info.intersectPolys && info.intersectPolys.length > 0) {
                insidePoly = true;
                isInsideObject = false;
                // console.log("inside poly: ", insidePoly, "isInsideObject: ", isInsideObject);
            } else {
                insidePoly = false;
                if (info.alpha == 255) {
                    $('.leaflet-container').css('cursor', 'pointer');
                    isInsideObject = true;
                    // console.log("inside poly: ", insidePoly, "isInsideObject: ", isInsideObject);
                } else {
                    isInsideObject = false;
                    // console.log("inside poly: ", insidePoly, "isInsideObject: ", isInsideObject);
                }
            }

            if (insidePoly) {
                $('.leaflet-container').css('cursor', 'pointer');

                var poly = info.intersectPolys.topPoly;
                if (!poly || !poly.size || poly.size.length == 0) return;

                var insideTheSamePoly = function(info, lastRecentInfo) {
                    // console.log("inside the same poly");
                    return self.lastRecentInfo && self.lastRecentInfo.imgsPolyCropped && self.lastRecentInfo.intersectPolys && info.intersectPolys && (self.lastRecentInfo.intersectPolys.topPolyID == info.intersectPolys.topPolyID);
                }

                if (insideTheSamePoly(info, self.lastRecentInfo)) {
                    return;
                }

                if (self.lastRecentInfo && self.lastRecentInfo.imgsPolyCropped) {
                    self.redrawFn(self.lastRecentInfo.imgsPolyCropped);
                }


                var imgsPolyCropped = self.cropImgBoxs(poly.posL, poly.size[0], poly.size[1], info.coords, poly.canvas);
                info.imgsPolyCropped = imgsPolyCropped;

                // console.log(poly);
                if (self.lastRecentInfo && self.lastRecentInfo.img) {
                    self.redrawFn(self.lastRecentInfo.img);
                }

                self.draw(poly.posL, poly.size[0], poly.size[1], info.coords, poly.canvas2);

                self.lastRecentInfo = info;

            } else {
                if (self.lastRecentInfo && self.lastRecentInfo.imgsPolyCropped) {
                    self.redrawFn(this.lastRecentInfo.imgsPolyCropped);
                    self.lastRecentInfo.imgsPolyCropped = null;
                }
            }

            //--------------------------------------------------------------------------------------------------        

            if (isInsideObject) {
                if (info.topCircleID && lastRecentInfo && lastRecentInfo.img &&
                    self.lastRecentInfo.topCircleID && info.topCircleID == self.lastRecentInfo.topCircleID) {
                    return;
                }

                if (self.lastRecentInfo && self.lastRecentInfo.img) {
                    var lastTopPointTile = this.lastRecentInfo.topPointTile;
                    if (lastTopPointTile) {
                        self.redrawFn(lastRecentInfo.img);
                    }
                }

                var topPointTile = info.topPointTile;

                if (topPointTile) {
                    var WIDTH, HEIGHT;
                    WIDTH = HEIGHT = radius << 1;
                    var imgs = this.cropImgBoxs(info.topPointlatlng, WIDTH, HEIGHT, info.coords);
                    info.img = imgs;
                    // console.log("Draw ",++count);                    
                    self.draw(info.topPointlatlng, WIDTH, HEIGHT, info.coords, img_blueCircle);
                }

                self.lastRecentInfo = info;
            } else {
                if (self.lastRecentInfo && self.lastRecentInfo.img) {
                    var topPointTileRecent = this.lastRecentInfo.topPointTile;
                    if (topPointTileRecent) {
                        // console.log("Redraw ",count);
                        self.redrawFn(lastRecentInfo.img);
                    }
                    self.lastRecentInfo = undefined;
                }
                $('.leaflet-container').css('cursor', 'auto');
            }
        }, 10);

    },
});

L.TileLayer.maskCanvas = function(options) {
    return new L.GridLayer.MaskCanvas(options);
};
