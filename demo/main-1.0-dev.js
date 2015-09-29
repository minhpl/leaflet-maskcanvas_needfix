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

    const RADIUS = 10;
    const NUM_POLYGON = 50;
    const TILESIZE = 256;
    const REALDATA = false;


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
        debug: true,
        map: map,
        boundary: true,
        img_on: img_blueCircle,
    });

    var swBound = L.latLng(20.69814614, 105.72596769);
    var neBound = L.latLng(21.09130007, 105.89789663);
    var bound = L.latLngBounds(swBound, neBound);
    map.fitBounds(bound);

    var settedData = false;

    if (REALDATA) {
        var zoom = map.getZoom();
        var socket = io.connect('http://10.61.64.127:8822');
        socket.on('connect', function() {
            socket.emit("filter_boundary", {
                request: {
                    zoomLevel: zoom + '',
                    mnc: '4',
                    endDate: 1442547396748,
                    point4: {
                        lng: 125,
                        lat: 25
                    },
                    point1: {
                        lng: 105,
                        lat: 15
                    },
                    point2: {
                        lng: 105,
                        lat: 25
                    },
                    startDate: 1380339396748,
                    point3: {
                        lng: 125,
                        lat: 15
                    }
                }
            });
        });

        socket.on('filter_boundary', function(msg) {
            var aryData = msg.data.result;

            var dataPoly = [];
            var id = 0;
            for (k = 0; k < aryData.length; k++) {
                var lat = aryData[k].lat;
                var lng = aryData[k].lng;
                var count2G = aryData[k]._2Gcounter;
                var count3G = aryData[k]._3Gcounter;
                var rssi = aryData[k].rssiSum;
                var ecno = aryData[k].ecnoSum;
                var rscp = aryData[k].rscpSum;
                var posL = [lat, lng];
                var poly = makeVPolygonKientn2_backup(lat, lng, zoom, count2G, count3G, rssi, ecno, rscp);

                dataPoly.push(poly);
            }

            if (!settedData) {
                coverageLayer.setDataPoly(dataPoly);
                settedData = true;
            } else {
                coverageLayer.clearPolyMarker();
                coverageLayer.addPolygonMarker(dataPoly);
                coverageLayer.redraw();
            }

            map.dragging.enable();
            map.touchZoom.enable();
            map.doubleClickZoom.enable();
            map.scrollWheelZoom.enable();
            socket.disconnect();
        });

        map.on('zoomend', function() {

            var zoom = map.getZoom();

            map.dragging.disable();
            map.touchZoom.disable();
            map.doubleClickZoom.disable();
            map.scrollWheelZoom.disable();
            var socket = io.connect('http://10.61.64.127:8822');
            socket.on('connect', function() {
                socket.emit("filter_boundary", {
                    request: {
                        zoomLevel: zoom + '',
                        mnc: '4',
                        endDate: 1442547396748,
                        point4: {
                            lng: 125,
                            lat: 25
                        },
                        point1: {
                            lng: 105,
                            lat: 15
                        },
                        point2: {
                            lng: 105,
                            lat: 25
                        },
                        startDate: 1380339396748,
                        point3: {
                            lng: 125,
                            lat: 15
                        }
                    }
                });
            });
            socket.on('filter_district', function(msg) {
                var aryData = msg.data.result;
                var dPoly = [];
                var id = 0;

                var dataPoly = [];
                for (i = 0; i < aryData.length; i++) {
                    var lat = aryData[i].lat;
                    var lng = aryData[i].lng;
                    var count2G = aryData[i]._2Gcounter;
                    var count3G = aryData[i]._3Gcounter;
                    var rssi = aryData[i].rssiSum;
                    var ecno = aryData[i].ecnoSum;
                    var rscp = aryData[i].rscpSum;
                    var posL = [lat, lng];
                    var poly = makeVPolygonKientn2(lat, lng, zoom, count2G, count3G, rssi, ecno, rscp);

                    poly.posL = posL;


                    console.log("poly", poly);

                    dataPoly.push(poly);

                    coverageLayer.getVertexAndBoundinLatLng(poly);
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
                coverageLayer._rtreePolygon = new rbush(32);
                // coverageLayer._rtreePolygon.load(null);
                coverageLayer._rtreePolygon.load(dPoly);
                socket.disconnect();
            });

            socket.on('filter_boundary', function(msg) {
                var aryData = msg.data.result;

                var dataPoly = [];
                var id = 0;
                for (k = 0; k < aryData.length; k++) {
                    var lat = aryData[k].lat;
                    var lng = aryData[k].lng;
                    var count2G = aryData[k]._2Gcounter;
                    var count3G = aryData[k]._3Gcounter;
                    var rssi = aryData[k].rssiSum;
                    var ecno = aryData[k].ecnoSum;
                    var rscp = aryData[k].rscpSum;
                    var posL = [lat, lng];
                    var poly = makeVPolygonKientn2_backup(lat, lng, zoom, count2G, count3G, rssi, ecno, rscp);

                    dataPoly.push(poly);
                }

                if (!settedData) {
                    coverageLayer.setDataPoly(dataPoly);
                    settedData = true;
                } else {
                    coverageLayer.clearPolyMarker();
                    coverageLayer.addPolygonMarker(dataPoly);
                    // coverageLayer.setDataPoly(dataPoly);
                    coverageLayer.redraw();
                }

                map.dragging.enable();
                map.touchZoom.enable();
                map.doubleClickZoom.enable();
                map.scrollWheelZoom.enable();
                socket.disconnect();
            });
        });
    } else {
        coverageLayer.setDataPoly();
        coverageLayer.setDataCell(celldata);
    }

    map.addLayer(coverageLayer);

    function cropImage(canvas, centrePoint, WIDTH, HEIGHT, alph) {
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
    }

    function getID(zoom, x, y) {
        var _x = x < 0 ? 0 : x;
        var _y = y < 0 ? 0 : y;
        var result = {};

        result.id = zoom + "_" + _x + "_" + _y;
        result.coords = L.point(_x, _y);
        result.coords.zoom = zoom;
        var tile = coverageLayer.tiles.get(result.id);
        if (tile) {
            result.canvas = tile.canvas;
            if (!result.canvas) console.log("No canvas 1");
        } else {
            var tile = coverageLayer.hugeTiles.get(result.id);
            if (tile) {
                result.canvas = tile.canvas;
                if (!result.canvas) console.log("No canvas 2");
            } else {
                result.canvas = coverageLayer.canvases.get(result.id);
            }
        }
        return result;
    }

    function getTileIDs(centrePoint, WIDTH, HEIGHT, coords) {
        // var TopPoint = info.topPointTile;
        // console.log("--------",info)
        var radius = coverageLayer.options.radius >> 1;
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
                tileIDs.push(getID(zoom, tileIDX + i, tileIDY + j)) //8
            }

        return tileIDs;
    }

    function draw(topPointlatlng, WIDTH, HEIGHT, coords, img) {
        var w = WIDTH >> 1;
        var h = HEIGHT >> 1;
        var lat = topPointlatlng[0];
        var lng = topPointlatlng[1];
        var topPts = [lat, lng];

        // var WIDTH,HEIGHT;
        // WIDTH = HEIGHT = coverageLayer.options.radius;

        var topPointTile = coverageLayer._tilePoint(coords, topPts);

        var tileIDs = getTileIDs(topPointTile, WIDTH, HEIGHT, coords);


        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];

            var canvas = tile.canvas;
            var coords = tile.coords;
            var tilePoint = coverageLayer._tilePoint(coords, topPts);
            if (canvas) {
                var ctx = canvas.getContext('2d');
                // img.onload= function(){
                drawImage(ctx, img, tilePoint[0] - w, tilePoint[1] - h);
            }
        }
    }

    function putImageData(topPointlatlng, WIDTH, HEIGHT, coords, imgData) {
        var w = WIDTH >> 1;
        var h = HEIGHT >> 1;
        var lat = topPointlatlng[0];
        var lng = topPointlatlng[1];
        var topPts = [lat, lng];

        // var WIDTH,HEIGHT;
        // WIDTH = HEIGHT = coverageLayer.options.radius;                

        var topPointTile = coverageLayer._tilePoint(coords, topPts);

        var tileIDs = getTileIDs(topPointTile, WIDTH, HEIGHT, coords);

        for (var i = 0; i < tileIDs.length; i++) {
            var tile = tileIDs[i];
            var canvas = tile.canvas;
            var coords = tile.coords;
            var tilePoint = coverageLayer._tilePoint(coords, topPts);
            if (canvas) {
                var ctx = canvas.getContext('2d');
                // img.onload= function(){
                // drawImage(ctx, img, tilePoint[0] - w, tilePoint[1] - h);
                // console.log(w, h);
                ctx.putImageData(imgData, tilePoint[0] - w, tilePoint[1] - h);
            }
        }
    }

    function redraw(imgs) {
        if (imgs && imgs.length) {
            for (var i = 0; i < imgs.length; i++) {
                var image = imgs[i];
                image.draw();
            }
        }
    }

    function drawImage(ctx, image, x, y) {
        function f() {
            drawImage(ctx, image, x, y);
        }
        try {
            if (image.width == 0 || image.height == 0)
                return;
        } catch (e) {
            if (e.name == "NS_ERROR_NOT_AVAILABLE") {
                // Wait a bit before trying again; you may wish to change the
                // length of this delay.
                setTimeout(f, 100);
            } else {
                throw e;
            }
        }
    }

    //crop images at Position
    function cropImgBoxs(centreLatLng, WIDTH, HEIGHT, coords) {
        var topPointTile = coverageLayer._tilePoint(coords, [centreLatLng[0], centreLatLng[1]]);

        var w = WIDTH >> 1; //  mean  w/=2
        var h = HEIGHT >> 1; //  mean  w/=2        

        var tileIDs = getTileIDs(topPointTile, WIDTH, HEIGHT, coords);

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
            var tilePoint = coverageLayer._tilePoint(coords, topPts);
            var img = cropImage(canvas, tilePoint, WIDTH, HEIGHT, 255);

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
    }

    var lastRecentInfo = {
        imgCropped: undefined,
        polyID: undefined,
        poly: undefined,
    };

    var currentInfo = {
        isInsidePoly: undefined,
    }

    var timeoutID = undefined;

    function onMouseMove(e) {
        if (timeoutID) clearTimeout(timeoutID);

        timeoutID = setTimeout(function() {
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
                var rtree = coverageLayer._rtreePolygon;
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

            var radius = coverageLayer.getRadius(zoom);
            var pad = L.point(radius, radius);
            var tlPts = currentPoint.subtract(pad);
            var brPts = currentPoint.add(pad);
            var nw = map.unproject(tlPts, zoom);
            var se = map.unproject(brPts, zoom);
            var bound = [se.lat, nw.lng, nw.lat, se.lng];

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

            function getIntersectCell(bound) {
                var cells = coverageLayer._rtreeCell.search(bound);

                var result = [];
                var id = -1,
                    topCell = undefined;

                if (cells.length > 0) {

                    for (var i = 0; i < cells.length; i++) {
                        var r = cells[i];
                        var cell = r[4];
                        var center = map.project(L.latLng(cell.lat, cell.lng));
                        if (isInsideSector(currentPoint, center, radius, cell.startRadian, cell.endRadian)) {
                            result.push(cell);
                            var a = r[5];
                            if (id < a) {
                                topCell = cell;
                                id = a;
                            }
                        }
                    }

                    result.topCell = topCell;
                    result.id = id;
                    return result;
                }

                return [];
            }

            var cells = getIntersectCell(bound);

            if (polys.topPoly) {
                $('.leaflet-container').css('cursor', 'pointer');
                var poly = polys.topPoly;

                if (lastRecentInfo.polyID && (polys.topPolyID == lastRecentInfo.polyID)) {
                    // return;
                } else {                    
                    if (lastRecentInfo.imgCropped)
                        redraw(lastRecentInfo.imgCropped);

                    lastRecentInfo.polyID = polys.topPolyID;
                    lastRecentInfo.poly = poly;

                    var sizeWidth = poly.size[0];
                    var sizeHeigth = poly.size[1];
                    if (sizeWidth != 0 && sizeHeigth != 0) {                        
                        lastRecentInfo.imgCropped = cropImgBoxs(poly.posL, poly.size[0], poly.size[1], coords);
                        // console.log("here");
                        draw(poly.posL, poly.size[0], poly.size[1], coords, poly.canvas2);
                    }
                }
            } else {
                $('.leaflet-container').css('cursor', 'auto');
                if (lastRecentInfo.polyID == undefined) {
                    // console.log("is in the same blank");
                    // return;
                } else {
                    lastRecentInfo.polyID = undefined;
                    lastRecentInfo.poly = undefined;
                    redraw(lastRecentInfo.imgCropped);
                }
            }

            // if (cells.topCell) {
            //     $('.leaflet-container').css('cursor', 'pointer');                
            // }
            // else
            // {
            //     $('.leaflet-container').css('cursor', 'auto');
            // }

        }, 0);
    }

    map.on('mousemove', onMouseMove);

    map.on('contextmenu', onContextMenu);

    map.on('click', onContextMenu);

    function onContextMenu(e) {
        console.log("onContextMenu", lastRecentInfo.poly, lastRecentInfo.polyID);
    }

});
