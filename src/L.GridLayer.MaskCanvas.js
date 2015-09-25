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

L.GridLayer.MaskCanvas = L.GridLayer.extend({
    options: {
        // db: new PouchDB('vmts'),
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

    /**
     * [updateCachedTile description]
     * @param  {[type]} coords   [description]
     * @param  {[type]} numPoint [description]
     * @return {[type]}          [description]
     */

    getRadius: function(zoom) {
        switch (zoom) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
                return 4;
            case 6:
            case 7:
            case 8:
            case 9:
                return 6;
            case 10:
            case 11:
            case 12:
                return 8;
            case 13:
                return 12;
            case 14:
                return 16;
            case 15:
                return 20;
            case 16:
                return 24;
            case 17:
                return 30;
            case 18:
                return 36;
            default:
                return 38;
        }
    },

    initialize: function(options) {
        L.setOptions(this, options);
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
    },

    // globalData: function() {
    //     this.options.useGlobalData = true;
    // },

    // localData: function() {
    //     this.options.useGlobalData = false;
    // },

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

                // 21.15176, 105.65826
                // 20.76831, 105.25108
                var lat = 20.76831 + Math.random() * (21.15176 - 20.76831);
                var lng = 105.25108 + Math.random() * (105.65826 - 105.25108);

                var poly = makeVPolygon2(lat, lng, maxWith, maxHeight); //tao hinh dang cua polygon                        
                poly[0].c = 'rgba(255, 255, 102,1)';

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

                cell.startRadian = NORTH + azimuthR - HCELLARCSIZE;
                cell.endRadian = NORTH + azimuthR + HCELLARCSIZE;

                cell.in = function isInsideSector(point, center, radius, angle1, angle2) {
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
                };

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

    //important function
    _draw: function(canvas, coords) {
        // var valid = this.iscollides(coords);
        // if (!valid) return;  
        if (!this._rtreePolygon || !this._map) {
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

        var queryCells = function(coords) {

            var bb = getBB(coords, self.getRadius(coords.z));

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
    },

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
            poly.canvas2 = this.getCanvas(poly, coords, "rgba(250, 235, 215,1)");
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

    drawCell: function(ctx, pts, cell, radius) {
        var x = pts[0];
        var y = pts[1];

        var color = cell.cell_type == 2 ? RED : BLUE;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, radius, cell.startRadian, cell.endRadian, false);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();
    },

    drawCells: function(canvas, coords, cells) {
        var ctx = canvas.getContext('2d');
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i][4];
            var pos = this._tilePoint(coords, [cell.lat, cell.lng]);
            // console.log(coords.z, "-----------");
            this.drawCell(ctx, pos, cell, this.getRadius(coords.z));
        }
    },

});

L.TileLayer.maskCanvas = function(options) {
    return new L.GridLayer.MaskCanvas(options);
};
