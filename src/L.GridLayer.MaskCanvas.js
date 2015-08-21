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


    makeBDataPoly: function() {
        var dlength = dataset.length;
        var interval = (dlength / NUMBPOLYGON) >> 0;
        // console.log("interval ", interval);
        var dPoly = [];
        var id = 0;


        for (var i = 0, j = 0; i < dlength && j < NUMPOLYGON; i += interval, j++) {
            var posL = dataset[i];

            var poly = makeBPolygons();
            poly.posL = posL;

            this.getVertexAndBoundinLatLng(poly);

            lBounds = poly.lBounds;
            var a = [lBounds.getSouth(), lBounds.getWest(), lBounds.getNorth(), lBounds.getEast(), poly, id++];
            dPoly.push(a);

            console.log(poly);
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

    getStoreObj: function(id) {
        var db = this.options.db;
        // console.log("getStoreObj ",id);
        var self = this;
        var promise = new Promise(function(res, rej) {
            if (!self.ready) {
                rej("Not ready");
                return;
            }
            if (db) {

                db.get(id, {
                    attachments: false
                }).then(function(doc) {
                    console.log("Found ", doc);
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

                        var db = self.options.db;
                        // console.log("Get Attachment from ",doc);
                        db.getAttachment(id, "image", {
                            rev: doc._rev
                        }).then(function(blob) {
                            // console.log("Loaded image tile ", id + "/image : ",  blob);
                            var blobURL = blobUtil.createObjectURL(blob);

                            var newImg = new Image();
                            newImg.src = blobURL;

                            // newImg.onload = function(){
                            doc.img = newImg;
                            if (doc.numPoints < HUGETILE_THREADSHOLD) {
                                var nTile = self.tiles.get(id);
                                if (!nTile || !nTile.img)
                                    self.store(id, doc);
                            } else {
                                var nTile = self.hugeTiles.get(id);
                                if (!nTile || !nTile.img)
                                    self.hugeTiles.set(id, doc);
                            }
                            // resolve(res);  
                            // }


                        }, function(err) {
                            // console.log(id, err);
                            // res.status = LOADED;
                            // resolve(res);
                        });
                    }

                    res(doc);
                }).catch(function(err) {
                    console.log(err);
                    rej(err);
                });
            } else rej(new Error("No DB found"));
        });
        return promise;
    },

    getTile: function(coords) {
        var id = coords.z + "_" + coords.x + "_" + coords.y;
        var valid = this.iscollides(coords);
        if (!valid) {
            // console.log("Not valid");
            return Promise.resolve(EMPTY);
        }
        var tile = this.hugeTiles.get(id) || this.tiles.get(id);
        var self = this;
        // if (tile) console.log("Status ",tile.status);
        if (!tile || tile.status == UNLOAD) {
            if (self.emptyTiles.get(id))
                return Promise.resolve(EMPTY);

            if (!tile) {
                tile = {};
            }

            tile.status = LOADING;

            self.store(id, tile);

            var promise = new Promise(function(resolve, reject) {
                var out = self.getStoreObj(id).then(function(res) {
                    self.store(id, res);
                    res.status = LOADED;

                    if (res.numPoints == 0) {
                        self.emptyTiles.set(id, {});
                        self.tiles.remove(id);
                        if (self.needPersistents > self.tiles.size)
                            self.needPersistents--;
                        console.log("Store empty tile ", self.emptyTiles.size);
                    }

                    resolve(res);


                }, function(err) {
                    // console.log(err);
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
                    // console.log(bb);
                    var pointCoordinates = (self.options.useGlobalData) ? null : self._rtree.search(bb);


                    if (pointCoordinates && pointCoordinates.length === 0) {
                        console.log("Store empty tile ", self.emptyTiles.size);
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
                        needSave: true
                    }

                    if (numPoints >= HUGETILE_THREADSHOLD) {
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

    backupOne: function() {        
        var self = this;
        var db = self.options.db;
        if (db && self.needPersistents > 0) {

            var node = self.tiles.head;
            var i = 0;
            while (node) {

                console.log("-------------------------");
                var value = node.value;
                if (value.needSave) {
                    self.backupToDb(db, value);
                    // console.log("Backup once ",value);
                    break;
                }
                i++;
                node = node.next;
            }
            self.needPersistents = 0;
        }
    },

    backupToDb: function(db, tile) {        

        // console.log("Remove from memory, backup to DB ", tile);
        if (tile.needSave && tile.status == LOADED && !tile.empty) {
            var self = this;
            tile.needSave = false;
            // console.log("Remove from memory 22, backup to DB ", tile);
            // var db = self.options.db;
            if (db) {
                if (self.needPersistents > 0) self.needPersistents--;

                function retryUntilWritten(id, name, rev, blob, type, callback) {

                    console.log("Main: ",id,name,rev,blob,type); 

                    
                    var worker = new Worker('Worker.js');
                    worker.postMessage({
                        'id': id,
                        'name': name,
                        'rev': rev,
                        'blob': blob,
                        'type': type,                        
                        // 'count': count
                    });


                    // var count = 0;                    
                    // db.putAttachment(id, name, rev, blob, type, function(e, r) {
                    //     if (e) {
                    //         if (e.status === 409 && count++ < 20) {
                    //             console.log("Stored blob", e);
                    //             retryUntilWritten(id, name, rev, blob, type, callback);
                    //         } else console.log("Error ", e);
                    //     } else {
                    //         // console.log("Store blob successfully", r);
                    //         if (callback) callback(r);
                    //     }
                    // });
                }


                var simpleTile = {
                    _id: tile._id,
                    numPoints: tile.numPoints,
                    data: self.options.useGlobalData ? undefined : tile.data,
                    bb: tile.bb,
                    status: LOADED,
                    needSave: false
                }

                if (self.options.useGlobalData) delete simpleTile.data;

                if (!self.prev) self.prev = Promise.resolve();
                self.prev = self.prev.then(function() {

                    return new Promise(function(resolve, reject) {
                        db.upsert(tile._id, function(doc) {
                            // console.log("Upsert ", doc, simpleTile);
                            if (doc._rev) simpleTile._rev = doc._rev;
                            return simpleTile;
                        }).then(function(response) {
                            // console.log("upserted ", response);
                            tile._rev = response.rev; //Updating revision                    
                            if (tile.numPoints > 0 && tile.canvas) {
                                // console.log(tile.data.length, tile._id);
                                return blobUtil.canvasToBlob(tile.canvas).then(function(blob) {
                                    retryUntilWritten(tile._id, "image", response.rev, blob, 'image/png', function(r) {
                                        // console.log("Store blob successfully", r);
                                        resolve();
                                    });
                                    // resolve();
                                    // success
                                }).catch(function(err) {
                                    // error
                                    console.log(err);
                                    reject(err);
                                });
                            } else resolve();
                            console("Resolved");
                        }).catch(function(err) {
                            console.log("Reject : ", err);
                            reject(err);
                        })
                    });

                });

            }
        }
    },


    store: function(id, tile) {
        var self = this;
        // console.log("No tiles stored ",self.tiles.size);        
        return self.tiles.set(id, tile, function(removed) {
            self.backupToDb(self.options.db, removed.value);
        })
    },


    /**
     * @param {HTMLCanvasElement|HTMLElement} canvas
     * @param {L.Point} coords
     * @private
     */
    _draw: function(canvas, coords) {
        // var valid = this.iscollides(coords);
        // if (!valid) return;
        // if (!this._rtree || !this._map) {
        //   return;
        // }
        var id = coords.z + "_" + coords.x + "_" + coords.y;
        this.canvases.set(id, canvas, function(removed, keyadd) {
            // console.log("add:", "removed: ",removed.key);
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

        // this._drawVPolys(canvas, coords, vpolyCoordinates);

        // var getTilePoint = function(poly, coords) {
        //     var latLng = poly.latLng;
        //     var tilePoint = self._tilePoint(coords, [latLng.lat, latLng.lng]);
        //     return tilePoint;
        // };

        // var translate = function(poly, posPolyPoint) {
        //     var bb = poly.bb;
        //     var xCentre = bb[6];
        //     var yCentre = bb[7];


        //     var dx = posPolyPoint[0] - xCentre;
        //     var dy = posPolyPoint[1] - yCentre;

        //     var newBB = [bb[0] + dx, bb[1] + dy, bb[2] + dx, bb[3] + dy,
        //         bb[4], bb[5], posPolyPoint[0], posPolyPoint[1]
        //     ];

        //     poly.bb = newBB;
        //     return poly;
        // }

        // // padding
        // var pad = new L.Point(this._getMaxRadius(coords.z), this._getMaxRadius(coords.z));
        // nwPoint = nwPoint.subtract(pad);
        // sePoint = sePoint.add(pad);

        // var bounds = new L.LatLngBounds(this._map.unproject(sePoint, coords.z), this._map.unproject(nwPoint, coords.z));

        // var currentBounds = this._boundsToQuery(bounds);
        // var bb = [currentBounds.y,currentBounds.x,currentBounds.y+currentBounds.height,currentBounds.x+currentBounds.width];
        // // console.log(bb);
        // var pointCoordinates = this._rtree.search(bb);
        var self = this;
        (function(self, canvas, coords) {
            var id = coords.z + "_" + coords.x + "_" + coords.y;
            self.getTile(coords).then(function(tile) {
                if (!tile || tile.status != LOADED || tile.empty) {
                    return;
                }
                var ctx = canvas.getContext('2d');
                if (tile) {
                    // if (!tile.canvas) {
                    tile.canvas = canvas;
                    // self.store(id, tile);
                    // }                    

                    if (tile.img) {
                        // console.log("Draw from saved tile ",tile);
                        // var nw = self._tilePoint(coords,tile.bb);
                        // console.log("Draw at ",tile.bb,nw);                      

                        // console.log("sorted = ",tile.sorted);
                        if (tile.img.complete) {
                            ctx.drawImage(tile.img, 0, 0);
                        } else {
                            tile.img.onload = function(e) {
                                if (e.target.complete) {
                                    ctx.drawImage(tile.img, 0, 0);
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
                                                    ctx.drawImage(tile.img, 0, 0);
                                                } else {
                                                    retryLoadImage();
                                                }
                                            }
                                            countTimes++;
                                        }, 50);
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
                            // console.log("Store empty tile ", self.emptyTiles.size);
                            self.emptyTiles.set(id, {});
                            self.tiles.remove(id);
                            if (self.needPersistents > self.tiles.size)
                                self.needPersistents--;
                            // console.log("Remove empty tile from current saved tiles",self.tiles.size);                                                                                       
                        }
                    } else self._drawPoints(canvas, coords, tile.data, tile.sorted);
                    tile.sorted = true;

                    if (tile.numPoints > 0) {
                        var img = new Image();
                        img.src = canvas.toDataURL("image/png");


                        // img.onload = function(){
                        // console.log("Store Img to tile");
                        var nTile = self.tiles.get(id);
                        if (!nTile || !nTile.img) {
                            tile.img = img;

                            if (tile.numPoints >= HUGETILE_THREADSHOLD) {
                                self.hugeTiles.set(id, tile);
                                tile.needSave = false;
                            } else self.store(id, tile);

                            if (tile.needSave) {
                                self.needPersistents++;
                                // console.log("Need persistent ",self.needPersistents,self.tiles.size);
                            }

                        } else {
                            console.log("OMG_________________________________________________________OMG");

                            nTile.canvas = canvas;
                            ntile.needSave = false;
                            if (tile.numPoints >= HUGETILE_THREADSHOLD)
                                self.hugeTiles.set(id, nTile);
                            else self.store(id, nTile);
                        }
                        // };
                    }

                    // console.log("Update tile ",id,tile);
                    // self.store(id, tile);
                }
            }).then(function() {
                self._drawVPolys(canvas, coords, vpolyCoordinates);
            }).catch(function() {
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

    // drawVPoly: function(poly,canvas,coords) {
    //     var vertexsL = poly.vertexsL;

    //     var v0 = vertexsL[0];
    //     var p0 = this._tilePoint(coords,[v0.lat,v0.lng]);
    //     console.log("here",p0);

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
    }


});

L.TileLayer.maskCanvas = function(options) {
    return new L.GridLayer.MaskCanvas(options);
};
