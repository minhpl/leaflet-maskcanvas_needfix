$(function() {

    var map = new L.Map('map', {
        center: new L.LatLng(21.05223312, 105.72597225),
        zoom: 10,
        //layers: [osm]
    });

    var ggUrl = 'http://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
    var ggl = new L.TileLayer(ggUrl, {
        subdomains: "0123"
    });

    if (window.CanvasPixelArray) {
        CanvasPixelArray.prototype.set = function(arr) {
            var l = this.length,
                i = 0;
            for (; i < l; i++) {
                this[i] = arr[i];
            }
        };
    }

    map.addLayer(ggl);

    var isInsideObject = false;
    var canvas;
    var remoteCouch = false;

    var red_canvas = document.createElement('canvas');
    const RADIUS = 10;
    const NUM_POLYGON = 50;


    var numCircles = 10000;
    var WIDTH = 2000;
    var HEIGHT = 2000;

    red_canvas.width = RADIUS << 1;
    red_canvas.height = RADIUS << 1;
    var red_context = red_canvas.getContext('2d');
    red_context.beginPath();

    red_context.arc(RADIUS, RADIUS, RADIUS, 0, 2 * Math.PI, true);
    red_context.fillStyle = 'red';
    red_context.fill();
    red_context.lineWidth = 1;

    red_context.strokeStyle = '#003300';
    red_context.stroke();

    var img_redCircle = new Image();
    img_redCircle.src = red_canvas.toDataURL("image/png");


    var blue_canvas = document.createElement('canvas');
    blue_canvas.width = RADIUS << 1;
    blue_canvas.height = RADIUS << 1;
    var blue_context = blue_canvas.getContext('2d');
    blue_context.beginPath();

    blue_context.arc(RADIUS, RADIUS, RADIUS, 0, 2 * Math.PI, true);
    blue_context.fillStyle = 'blue';
    blue_context.fill();
    blue_context.lineWidth = 1;

    blue_context.strokeStyle = '#003300';
    blue_context.stroke();

    var img_blueCircle = new Image();
    img_blueCircle.src = blue_canvas.toDataURL("image/png");

    var coverageLayer = new L.GridLayer.MaskCanvas({
        opacity: 0.5,
        radius: RADIUS,
        useAbsoluteRadius: false,
        img_on: img_redCircle,
        img_off: img_blueCircle,
        debug: true,
        map: map
    });

    coverageLayer.setData(dataset);
    coverageLayer.localData();
    map.addLayer(coverageLayer);
    map.fitBounds(coverageLayer.bounds);


    // var drawnItems = new L.FeatureGroup();
    // map.addLayer(drawnItems);

    // // Set the title to show on the polygon button
    // L.drawLocal.draw.toolbar.buttons.polygon = 'Draw a sexy polygon!';

    // var drawControl = new L.Control.Draw({
    //     position: 'topright',
    //     draw: {
    //         polyline: {
    //             metric: true
    //         },
    //         polygon: {
    //             allowIntersection: false,
    //             showArea: true,
    //             drawError: {
    //                 color: '#b00b00',
    //                 timeout: 1000
    //             },
    //             shapeOptions: {
    //                 color: '#b00b00'
    //             }
    //         },
    //         circle: {
    //             shapeOptions: {
    //                 color: '#662d91'
    //             }
    //         },
    //         marker: false
    //     },
    //     edit: {
    //         featureGroup: drawnItems,
    //         remove: false
    //     }
    // });
    // map.addControl(drawControl);

    // map.on('draw:created', function(e) {
    //     var type = e.layerType,
    //         layer = e.layer;

    //     if (type === 'marker') {
    //         layer.bindPopup('A popup!');
    //     }

    //     drawnItems.addLayer(layer);
    // });

    // map.on('draw:edited', function(e) {
    //     var layers = e.layers;
    //     var countOfEditedLayers = 0;
    //     layers.eachLayer(function(layer) {
    //         countOfEditedLayers++;
    //     });
    //     console.log("Edited " + countOfEditedLayers + " layers");
    // });

    // L.DomUtil.get('changeColor').onclick = function() {
    //     drawControl.setDrawingOptions({
    //         rectangle: {
    //             shapeOptions: {
    //                 color: '#004a80'
    //             }
    //         }
    //     });
    // };






    // var MEM;
    /**
     * [cropImage description]
     * @param  {[type]} canvas      [description]
     * @param  {[type]} centrePoint : point relative with tile
     * @param  {[type]} WIDTH       [description]
     * @param  {[type]} HEIGHT      [description]
     * @param  {[type]} alph        [description]
     * @return {[type]}             [description]
     */





    /**
     * [getTileIDs description]
     * @param  {[type]} centrePoint point relative with tile
     * @param  {[type]} WIDTH       [description]
     * @param  {[type]} HEIGHT      [description]
     * @param  {[type]} coords      [description]
     * @return {[type]}             [description]
     */

    function onMouseClick_getID(e) {
        var currentPositionPoint = map.project(e.latlng);
        var Points = circleCentrePointCover(currentPositionPoint);
        if (!isInsideObject && !insidePoly) {
            alert("Not inside object");
            return;
        }

        if (insidePoly) {
            var intersectPolys = getIntersectPoly(e.latlng);
            if (!intersectPolys) return;


            var topPoly = intersectPolys.topPoly;
            var topPolyID = intersectPolys.topPolyID;

            var posL = topPoly.posL;
            var message = "lat: " + posL[0] + ",lng: " + posL[1] + ", id: " + topPolyID;
            popup.setLatLng(posL).setContent(message).openOn(map);

        } else if (isInsideObject) {
            var TopPoint = getTopPoint(Points);
            if (!TopPoint) return;
            var latLng = new L.LatLng(TopPoint[0], TopPoint[1]);
            var message = latLng.toString() + "id: " + TopPoint.id;
            popup.setLatLng(latLng).setContent(message).openOn(map);
        }
    }

    $('.leaflet-container').css('cursor', 'auto');

    // map.on('mousemove', onMouseMove);

    function onMouseMove_backUpOne(e) {
        // coverageLayer.backupOne();
    }

    map.on('mousemove', onMouseMove);

    function onMouseMove(e) {
        coverageLayer.onMouseMove(e);
    }

    function onMouseClick_showLatLng(e) {
        popup
            .setLatLng(e.latlng)
            .setContent("You clicked the map at " + e.latlng.toString())
            .openOn(map);
    }

    map.on('click', onMouseClick_addMarkers);

    var pad = L.point(red_canvas.width >> 1, red_canvas.height >> 1);
    var _pad = L.point(red_canvas.width, red_canvas.height);

    var prevPromise = Promise.resolve();

    function removeMarker(item, coords) {

        var promise2 = new Promise(function(resolve2, reject2) {

            coverageLayer._rtree.remove(item);
            var itemPos = L.latLng(item[0], item[1]);
            var db = coverageLayer.options.db;

            var createImageData = function(coords) {
                var zoom = coords.z;

                var itemPosPoint = map.project(itemPos, zoom);
                var tlCanvas = itemPosPoint.subtract(pad);

                var tlBoundQuery = itemPosPoint.subtract(_pad);
                var brBoundQuery = itemPosPoint.add(_pad);

                var nwBoundQuery = map.unproject(tlBoundQuery, zoom);
                var seBoundQuery = map.unproject(brBoundQuery, zoom);
                var boundQuery = [seBoundQuery.lat, nwBoundQuery.lng, nwBoundQuery.lat, seBoundQuery.lng];

                var _items = coverageLayer._rtree.search(boundQuery);
                _items.sort(function(a, b) {
                    return a[5] - b[5];
                });

                var subCanvas = document.createElement('canvas');
                subCanvas.width = red_canvas.width;
                subCanvas.height = red_canvas.height;
                var context = subCanvas.getContext('2d');

                var ll = map.unproject(tlCanvas, zoom);
                var pointTileCanvas = coverageLayer._tilePoint(coords, [ll.lat, ll.lng]);

                for (var i = 0; i < _items.length; i++) {
                    var _item = _items[i];
                    var tilePointItem = coverageLayer._tilePoint(coords, [_item[0], _item[1]]);

                    var _x = tilePointItem[0] - pointTileCanvas[0];
                    var _y = tilePointItem[1] - pointTileCanvas[1];

                    context.drawImage(red_canvas, _x - (red_canvas.width >> 1), _y - (red_canvas.height >> 1));
                }

                context.strokeStyle = '#000';
                context.beginPath();
                context.moveTo(0, 0);
                context.lineTo(red_canvas.width, 0);
                context.lineTo(red_canvas.width, red_canvas.height);
                context.lineTo(0, red_canvas.height);
                context.closePath();
                context.stroke();

                var imageData = context.getImageData(0, 0, subCanvas.width, subCanvas.height);

                return {
                    'imageData': imageData,
                    'pointTileCanvas': pointTileCanvas,
                }
            }


            var obj = createImageData(coords);
            var imageData = obj.imageData;
            putImageData([itemPos.lat, itemPos.lng], red_canvas.width, red_canvas.height, coords, imageData);

            if (coverageLayer.rtree_cachedTile) {
                var result = coverageLayer.rtree_cachedTile.search([itemPos.lat, itemPos.lng, itemPos.lat, itemPos.lng]);
                result.sort(function(a, b) {
                    var za = coverageLayer.getCoords(a[4]).z;
                    var zb = coverageLayer.getCoords(b[4]).z;
                    // console.log(za, zb);
                    return za - zb;
                })

                // console.log(result.length, result);

                var updateTile = function(tile) {

                    // console.log(tile);

                    var promise = new Promise(function(resolve, reject) {

                        var coords = coverageLayer.getCoords(tile._id);
                        tile.numPoints--;
                        // console.log("------", tile);
                        // resolve(tile);
                        // return;

                        if (tile.data && !coverageLayer.options.useGlobalData) {
                            if (tile.sorted)
                                data.pop();
                            else {
                                var index = data.lastIndexOf(item); //Note: browser support for indexOf is limited; it is not supported in Internet Explorer 7 and 8.
                                if (index > -1) {
                                    data.splice(index, 1);
                                }
                            }
                        }

                        // var promise = new Promise(resolve, response) {
                        if (tile.img) {
                            // console.log("--------------------------------------------------------------------");
                            var canvas = document.createElement('canvas');
                            canvas.width = canvas.height = TILESIZE;
                            var ctx = canvas.getContext('2d');
                            var img = tile.img;

                            if (img.complete) {
                                // console.log("img complete", tile._id);
                                ctx.drawImage(img, 0, 0);

                                var obj = createImageData(coords);
                                var imageData = obj.imageData;
                                var pos = obj.pointTileCanvas;
                                ctx.putImageData(imageData, pos[0], pos[1]);
                                // ctx.putImageData(imageData, 0, 0);
                                // tile.img.src = canvas.toDataURL("image/png");
                                tile.img = new Image(); //prevent fire loading function recursively 
                                tile.img.src = canvas.toDataURL("image/png");
                                // tile.canvas = canvas;
                                // console.log(tile);
                                resolve(tile);
                            } else {
                                tile.img.onload = function(e) {
                                    // console.log("img onload", tile._id);
                                    if (e.target.complete) {
                                        ctx.drawImage(img, 0, 0);

                                        var obj = createImageData(coords);
                                        var imageData = obj.imageData;
                                        var pos = obj.pointTileCanvas;
                                        ctx.putImageData(imageData, pos[0], pos[1]);
                                        // ctx.putImageData(imageData, 0, 0);

                                        // tile.img.src = canvas.toDataURL("image/png");
                                        // console.log("img onload2")
                                        tile.img = new Image();
                                        tile.img.src = canvas.toDataURL("image/png");
                                        // tile.canvas = canvas;
                                        resolve(tile);
                                        // console.log(tile);
                                    } else {
                                        var maxTimes = 10;
                                        var countTimes = 0;
                                        var resolved = false;

                                        function retryLoadImage() {
                                            setTimeout(function() {
                                                if (countTimes > maxTimes) {
                                                    // -- cannot load image.
                                                    // console.log("cannot load image");
                                                    if (!resolved) {
                                                        reject("cannot load image")
                                                        resolved = true;
                                                    };
                                                    return;
                                                } else {
                                                    if (e.target.complete) {
                                                        // console.log("retry load image");
                                                        ctx.drawImage(img, 0, 0);

                                                        var obj = createImageData(coords);
                                                        var imageData = obj.imageData;
                                                        var pos = obj.pointTileCanvas;
                                                        ctx.putImageData(imageData, pos[0], pos[1]);
                                                        // ctx.putImageData(imageData, 0, 0);
                                                        tile.img = new Image();
                                                        tile.img.src = canvas.toDataURL("image/png");
                                                        // tile.canvas = canvas;
                                                        // console.log("retryLoadImage");
                                                        if (!resolved) {
                                                            resolve(tile);
                                                            resolved = true;
                                                            // console.log(tile);
                                                        }
                                                    } else {
                                                        if (!resolved) retryLoadImage();
                                                    }
                                                }
                                                countTimes++;
                                            }, 50);
                                        };

                                        retryLoadImage();
                                    }
                                }
                            }
                        } else {
                            resolve(tile);
                        }

                    });

                    return promise;
                }

                var removeTileInDB = function(tile) {
                    var promise = new Promise(function(resolve, reject) {

                        db.get(tile._id).then(function(tile) {
                            return db.remove(tile);

                        }).then(function(response) {

                            resolve();
                        }).catch(function(err) {

                            // console.log("Err", err, tile._id, tile);
                            resolve();
                        });
                    });

                    return promise;
                }


                var backUptoDBSequently = function(tiles) {

                    var prev = Promise.resolve();
                    var size = tiles.length;
                    var count = 0;

                    // console.log("in here2", tiles);

                    if (tiles.length == 0)
                        return Promise.resolve();

                    var promise = new Promise(function(resolve, reject) {
                        tiles.forEach(function(tile) {
                            prev = prev.then(function(response) {
                                if (tile) {

                                    // console.log("----", HUGETILE_THREADSHOLD, EMPTY, tile.numPoints);

                                    if ((tile.numPoints > 0) && (tile.numPoints < HUGETILE_THREADSHOLD)) {
                                        coverageLayer.hugeTiles.remove(tile._id);
                                        // console.log("tile not empty", tile);
                                        // return Promise.resolve();
                                        return coverageLayer.store(tile._id, tile);
                                    } else if (tile.numPoints == 0) {
                                        // console.log("tile is empty");
                                        coverageLayer.tiles.remove(tile._id);
                                        coverageLayer.hugeTiles.remove(tile._id);
                                        coverageLayer.emptyTiles.set(tile._id, EMPTY);
                                        return removeTileInDB(tile);
                                    }
                                    return Promise.resolve();
                                } else {
                                    // console.log("tile is undefined");
                                    return Promise.resolve();
                                }
                            }).then(function(response) {

                                // var _tile = coverageLayer.tiles.get(tile._id);
                                // console.log(_tile, " tile in here");

                                count++;
                                if (count == size) {
                                    // console.log("ok ok");
                                    resolve();
                                }
                            }).catch(function(err) {
                                // console.log("Err", err);
                                reject(err);
                            });
                        });
                    })

                    return promise;
                }


                var updateInDb = function(id) {
                    var promise = new Promise(function(resolve, reject) {

                        coverageLayer.getStoreObj(id).then(function(tile) {
                            // console.log("get stored obj", tile._id, tile);
                            tile.neverSavedDB = true;
                            return updateTile(tile);
                        }).then(function(tile) {
                            tile.needSave = true;
                            if (tile.numPoints == 0) {
                                coverageLayer.emptyTiles.set(tile._id, EMPTY);
                                coverageLayer.tiles.remove(tile._id);
                            }
                            // console.log("updated stored obj", tile._id, tile);
                            resolve(tile);
                        }).catch(function(err) {
                            console.log("Err", "cannot get stored obj", err, id);
                            resolve();
                        });
                    });

                    return promise;
                }

                var ids = []; //id of tile not in cache
                var tiles = []; //tiles containt all tile from cache
                for (var i = 0; i < result.length; i++) {
                    var id = result[i][4];
                    var tile = coverageLayer.tiles.get(id) || coverageLayer.hugeTiles.get(id);

                    if (tile) {
                        tiles.push(tile);
                    } else {
                        if (!coverageLayer.emptyTiles.get(id))
                            ids.push(id);
                    }
                }

                Promise.all(tiles.map(function(tile) {
                        return updateTile(tile);
                    })).then(function(tiles) {
                        for (var i = 0; i < tiles.length; i++) {
                            var tile = tiles[i];
                            tile.needSave = true;
                            tile.neverSavedDB = true;
                            if (tile.numPoints > 0 && tile.numPoints < HUGETILE_THREADSHOLD)
                                coverageLayer.hugeTiles.remove(tile._id);
                            else if (tile.numPoints == 0) {
                                coverageLayer.emptyTiles.set(tile._id, EMPTY);
                                coverageLayer.tiles.remove(tile._id);
                            }
                        }

                        return backUptoDBSequently(tiles);
                    }).then(function(response) {
                        return Promise.all(ids.map(function(id) {
                            return updateInDb(id);
                        }));
                    }).then(function(tiles) {
                        // console.log("all tiles get from db", tiles);
                        return backUptoDBSequently(tiles);
                    }).then(function(response) {
                        // console.log("remove marker successfully");
                        resolve2();
                    })
                    .catch(function(err) {
                        console.log("Err", err);
                        reject2();
                    });
            }

        });


        return prevPromise.then(function() {
            return promise2;
        })

    }

    function removeMarkers(bb, coords, poly) {
        var items = coverageLayer._rtree.search(bb);
        var db = coverageLayer.options.db;

        items.pop();
        items.pop();
        items.pop();
        items.pop();

        console.log("items.length", items.length, bb);

        if (items.length == 0) return;

        var inPoly = function(item) {
            if (!poly) {
                return true;
            } else {
                //...
            }
        }

        // console.log("item remove", items);
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (inPoly(item))
                coverageLayer._rtree.remove(item);
        }

        var nw = L.latLng(bb[2], bb[1]);
        var se = L.latLng(bb[0], bb[3]);

        var tl = map.project(nw, coords.z);
        var br = map.project(se, coords.z);

        var _tlCanvas = tl.subtract(pad);
        var _brCanvas = br.add(pad);
        var tlBoundQuery = tl.subtract(_pad);
        var brBoundQuery = br.add(_pad);
        var nwBoundQuery = map.unproject(tlBoundQuery, coords.z);
        var seBoundQuery = map.unproject(brBoundQuery, coords.z);

        var width = ((_brCanvas.x - _tlCanvas.x) >> 0);
        var height = ((_brCanvas.y - _tlCanvas.y) >> 0);

        var boundQuery = [seBoundQuery.lat, nwBoundQuery.lng, nwBoundQuery.lat, seBoundQuery.lng];

        var llBound = L.latLngBounds(seBoundQuery, nwBoundQuery);
        var _pos = llBound.getCenter();

        var canvas = document.createElement('canvas');
        var context = canvas.getContext('2d');
        canvas.width = width;
        canvas.height = height;

        var _items = coverageLayer._rtree.search(boundQuery);
        _items.sort(function(a, b) {
            return a[5] - b[5];
        });
        // console.log(_items.length, _items);

        // return;
        for (var i = 0; i < _items.length; i++) {
            var item = _items[i];
            var pos = map.project(L.latLng(item[0], item[1]), coords.z);
            var x = pos.x - _tlCanvas.x;
            var y = pos.y - _tlCanvas.y;

            context.drawImage(red_canvas, x - (red_canvas.width >> 1), y - (red_canvas.height >> 1));
        }

        // context.strokeStyle = '#000';
        // context.beginPath();
        // context.moveTo(0, 0);
        // context.lineTo(canvas.width, 0);
        // context.lineTo(canvas.width, canvas.height);
        // context.lineTo(0, canvas.height);
        // context.closePath();
        // context.stroke();

        if (coverageLayer.options.debug) {
            context.beginPath();
            context.moveTo(pad.x, pad.y);
            context.lineTo(canvas.width - pad.x, pad.y);
            context.lineTo(canvas.width - pad.x, canvas.height - pad.y);
            context.lineTo(pad.x, canvas.height - pad.y);
            context.closePath();
            context.stroke();
        }

        var imageData = context.getImageData(0, 0, width, height);
        putImageData([_pos.lat, _pos.lng], width, height, coords, imageData);

        if (coverageLayer.rtree_cachedTile) {
            var result = coverageLayer.rtree_cachedTile.search(bb);
            // result.sort(function(a, b) {
            //     var za = coverageLayer.getCoords(a[4]).z;
            //     var zb = coverageLayer.getCoords(b[4]).z;
            //     // console.log(za, zb);
            //     return za - zb;
            // })


            var ids = []; //all ids, those can be in db
            for (var i = 0; i < result.length; i++) {
                var id = result[i][4];
                var inCache = false;
                if (coverageLayer.tiles.get(id)) {
                    coverageLayer.tiles.remove(id);
                    inCache = true;
                }
                if (coverageLayer.hugeTiles.get(id)) {
                    coverageLayer.hugeTiles.remove(id);
                    inCache = true;
                }

                // if (!inCache && !coverageLayer.emptyTiles.get(id))
                coverageLayer.tilesInDBNeedUpdate[id] = true;
            }
        }
    }

    var idMarker = 2000000;

    function addMarkers(items) {


        if (items.length == 0)
            return;

        var minx = 999,
            maxx = -999,
            miny = 999,
            maxy = -999;

        var data = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var lat = item[0];
            var lng = item[1];
            data.push([lat, lng, lat, lng, item, ++idMarker]);

            if (minx > lat)
                minx = lat;
            if (miny > lng)
                miny = lng;
            if (maxx < lat)
                maxx = lat;
            if (maxy < lng)
                maxy = lng;
        }

        var boundary = [minx, miny, maxx, maxy];
        console.log(data.length, boundary, data);


        coverageLayer._rtree.load(data);

        if (coverageLayer.rtree_cachedTile) {
            var result = coverageLayer.rtree_cachedTile.search(boundary);

            for (var i = 0; i < result.length; i++) {
                var id = result[i][4];

                if (coverageLayer.tiles.get(id))
                    coverageLayer.tiles.remove(id);
                if (coverageLayer.hugeTiles.get(id))
                    coverageLayer.hugeTiles.remove(id);
                if (coverageLayer.emptyTiles.get(id))
                    coverageLayer.emptyTiles.remove(id);

                coverageLayer.tilesInDBNeedUpdate[id] = true;
            }
        }
    }

    function onMouseClick_addMarkers(e) {

        if (!coverageLayer.indexI) {
            coverageLayer.indexI = 0;
        }

        var markers = [];
        for (i = 0; coverageLayer.indexI < dataAdd.length && i < 6; coverageLayer.indexI++, i++) {
            var items = dataAdd[coverageLayer.indexI];
            markers.push(items);
        }

        addMarkers(markers);
        coverageLayer.redraw();
    }

    var prev2 = Promise.resolve();

    function onMouseClick_removeMarker(e) {
        var zoom = map.getZoom();
        var latlng = e.latlng;

        var currentlatLng = L.latLng(latlng.lat, latlng.lng);
        var currentPoint = map.project(currentlatLng, zoom);

        var pad = L.point(red_canvas.width >> 1, red_canvas.height >> 1);
        var topLeft = currentPoint.subtract(pad);
        var bottomRight = currentPoint.add(pad);

        var nw = map.unproject(topLeft, zoom);
        var se = map.unproject(bottomRight, zoom);
        var bb = [se.lat, nw.lng, nw.lat, se.lng];
        // var bb;

        var x = (currentPoint.x / TILESIZE) >> 0;
        var y = (currentPoint.y / TILESIZE) >> 0;

        var coords = L.point(x, y);
        coords.z = zoom;
        var id = coverageLayer.getId(coords);

        var tile = coverageLayer.tiles.get(id) || coverageLayer.hugeTiles.get(id);

        if (tile)
            bb = tile.bb;
        else {
            var cachedTile = coverageLayer.all_tiles_id
            console.log("here");
        }

        console.log(bb);


        var nw = L.latLng(bb[2], bb[1]);
        var se = L.latLng(bb[0], bb[3]);
        var tl = map.project(nw, coords.z);
        var br = map.project(se, coords.z);


        console.log(tl, br);
        var tl = tl.add(pad);
        var br = br.subtract(pad);

        console.log(tl, br);

        var nw = map.unproject(tl, coords.z);
        var se = map.unproject(br, coords.z);
        bb = [se.lat, nw.lng, nw.lat, se.lng];

        // var items = coverageLayer._rtree.search(bb);

        // if (items.length == 0) {
        //     console.log("not found", coverageLayer._rtree);
        //     return;
        // }

        // items.sort(function(a, b) {
        //     return a[5] - b[5];
        // });


        // items.pop();
        // items.pop();
        // items.pop();
        // items.pop();

        // // console.log(item);
        // // removeMarker(item, coords);


        // // var prev = Promise.resolve();
        // items.forEach(function(item) {
        //     prev2 = prev2.then(function(response) {
        //         return removeMarker(item, coords);
        //     });
        // });


        removeMarkers(bb, coords);
    }

    var markerID = dataset.length;

    function drawMarker(marker) {
        var WIDTH, HEIGHT;
        WIDTH = HEIGHT = red_canvas.width;
        var centerlatLng = [marker.lat, marker.lng];

        var currentlatlng = L.latLng(marker.lat, marker.lng);
        var currentPoint = map.project(currentlatlng);

        var x = (currentPoint.x / TILESIZE) >> 0;
        var y = (currentPoint.y / TILESIZE) >> 0;
        var zoom = map.getZoom();
        //
        var tileID = zoom + "_" + x + "_" + y;

        //calculate Point relative to Tile
        var tileTop = x * TILESIZE;
        var tileLeft = y * TILESIZE;
        var point = L.point(tileTop, tileLeft);
        var coords = L.point(x, y);
        coords.z = zoom;


        var tilePoint = coverageLayer._tilePoint(coords, [marker.lat, marker.lng]);
        // console.log(tilePoint);

        var tileIds = coverageLayer.getTileIDs(tilePoint, WIDTH, HEIGHT, coords);
        // console.log(tileIds,tileIds.length);        

        draw(centerlatLng, WIDTH, HEIGHT, coords, red_canvas);

        for (var i = 0; i < tileIds.length; i++) {
            var tileID = tileIds[i].id;
            var canvas = coverageLayer.canvases.get(tileID);
            if (canvas && canvas.imgData) delete canvas.imgData;
        }

        var item = [marker.lat, marker.lng];
        var x = item[0];
        var y = item[1];
        var data = [x, y, x, y, item, ++markerID];
        coverageLayer._rtree.insert(data);

        var pad = L.point(red_canvas.width >> 1, red_canvas.height >> 1);
        var topLeft = currentPoint.subtract(pad);
        var bottomRight = currentPoint.add(pad);
        var nw = map.unproject(topLeft);
        var se = map.unproject(bottomRight);
        var bb = [se.lat, nw.lng, nw.lat, se.lng];
    }

    function onMouseClick_drawMarker(e) {

        var marker = {
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            img: blue_canvas,
            data: {},
            title: 'title',
        };

        drawMarker(marker);
    }
});
