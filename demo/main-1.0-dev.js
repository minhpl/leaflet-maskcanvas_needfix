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
    const TILESIZE = 256;

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
    coverageLayer.globalData();

    map.addLayer(coverageLayer);
    map.fitBounds(coverageLayer.bounds);

    function alpha(point, canvas) {

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
    }

    var MEM;
    /**
     * [cropImage description]
     * @param  {[type]} canvas      [description]
     * @param  {[type]} centrePoint : point relative with tile
     * @param  {[type]} WIDTH       [description]
     * @param  {[type]} HEIGHT      [description]
     * @param  {[type]} alph        [description]
     * @return {[type]}             [description]
     */
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

    var popup = L.popup();

    var i = 0;

    var lastRecentPoint;
    var lastRecentInfo;


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

    function getIntersectPoly(currentlatlng, tileID) {
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

    function getInfo(e) {
        // calulate ID
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
        var tilePoint = coverageLayer._tilePoint(coords, [currentlatlng.lat, currentlatlng.lng]);
        //
        tilePoint = L.point(tilePoint[0], tilePoint[1]);
        var result = {};

        var intersectPolys = getIntersectPoly(currentlatlng);
        result.intersectPolys = intersectPolys;
        // calculate alpha


        var tile = coverageLayer.tiles.get(tileID) || coverageLayer.hugeTiles.get(tileID);
        // var alph = (tile) ? alpha(tilePoint, tile.canvas) : -1;

        var alph = alpha(tilePoint, coverageLayer.canvases.get(tileID));

        //calculate points and top point.
        var pointslatlng = circleCentrePointCover(currentPoint);
        //calculate TopPoints
        // if(pointslatlng.length!=0){}
        var topPointlatlng = getTopPoint(pointslatlng);
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
    }

    /**
     * [getTileIDs description]
     * @param  {[type]} centrePoint point relative with tile
     * @param  {[type]} WIDTH       [description]
     * @param  {[type]} HEIGHT      [description]
     * @param  {[type]} coords      [description]
     * @return {[type]}             [description]
     */
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
        for (var i = 0; i < imgs.length; i++) {
            var image = imgs[i];
            image.draw();
        }
    }

    function drawImage(ctx, image, x, y) {
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

    var count = 0;

    var insidePoly = false;

    var timeoutID = undefined;

    function onMouseMove(e) {
        if (timeoutID) clearTimeout(timeoutID);

        timeoutID = setTimeout(function() {
            timeoutID = 0;

            coverageLayer.backupOne();
            var info = getInfo(e);

            var radius = coverageLayer.options.radius;

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
                    return lastRecentInfo && lastRecentInfo.imgsPolyCropped && lastRecentInfo.intersectPolys && info.intersectPolys && (lastRecentInfo.intersectPolys.topPolyID == info.intersectPolys.topPolyID);
                }

                if (insideTheSamePoly(info, lastRecentInfo)) {
                    return;
                }

                if (lastRecentInfo && lastRecentInfo.imgsPolyCropped) {
                    redraw(lastRecentInfo.imgsPolyCropped);
                }


                var imgsPolyCropped = cropImgBoxs(poly.posL, poly.size[0], poly.size[1], info.coords, poly.canvas);
                info.imgsPolyCropped = imgsPolyCropped;

                // console.log(poly);
                if (lastRecentInfo && lastRecentInfo.img) {
                    redraw(lastRecentInfo.img);
                }

                draw(poly.posL, poly.size[0], poly.size[1], info.coords, poly.canvas2);

                lastRecentInfo = info;

            } else {
                if (lastRecentInfo && lastRecentInfo.imgsPolyCropped) {
                    redraw(lastRecentInfo.imgsPolyCropped);
                    lastRecentInfo.imgsPolyCropped = null;
                }
            }

            //--------------------------------------------------------------------------------------------------        

            if (isInsideObject) {
                if (info.topCircleID && lastRecentInfo && lastRecentInfo.img &&
                    lastRecentInfo.topCircleID && info.topCircleID == lastRecentInfo.topCircleID) {
                    return;
                }

                if (lastRecentInfo && lastRecentInfo.img) {
                    var lastTopPointTile = lastRecentInfo.topPointTile;
                    if (lastTopPointTile) {
                        redraw(lastRecentInfo.img);
                    }
                }

                var topPointTile = info.topPointTile;

                if (topPointTile) {
                    var WIDTH, HEIGHT;
                    WIDTH = HEIGHT = radius << 1;
                    var imgs = cropImgBoxs(info.topPointlatlng, WIDTH, HEIGHT, info.coords);
                    info.img = imgs;
                    // console.log("Draw ",++count);                    
                    draw(info.topPointlatlng, WIDTH, HEIGHT, info.coords, img_blueCircle);
                }

                lastRecentInfo = info;
            } else {
                if (lastRecentInfo && lastRecentInfo.img) {
                    var topPointTileRecent = lastRecentInfo.topPointTile;
                    if (topPointTileRecent) {
                        // console.log("Redraw ",count);
                        redraw(lastRecentInfo.img);
                    }
                    lastRecentInfo = undefined;
                }
                $('.leaflet-container').css('cursor', 'auto');
            }
        }, 10);

    }

    function squaredistance(point1, point2) {
        return (point1.x - point2.x) * (point1.x - point2.x) + (point1.y - point2.y) * (point1.y - point2.y);
    }

    function circleCentrePointCover(currentPositionPoint) {
        var rtree = coverageLayer._rtree;

        var topLeft = currentPositionPoint.subtract(L.point(RADIUS, RADIUS));
        var nw = map.unproject(topLeft);
        var bottemRight = currentPositionPoint.add(L.point(RADIUS, RADIUS));
        var se = map.unproject(bottemRight);

        var box = [se.lat, nw.lng, nw.lat, se.lng];

        var result = rtree.search(box);

        var a = [];
        var radius = coverageLayer.options.radius / 2;
        for (var i = 0; i < result.length; i++) {
            var r = result[i];
            var latLng = L.latLng(r[0], r[1]);
            var point = map.project(latLng);

            if (squaredistance(currentPositionPoint, point) <= radius * radius) {
                a.push(r);
            }
        }
        return a;
    }

    function getTopPoint(Points) {
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
    }

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

    map.on('mousemove', onMouseMove_backUpOne);



    function onMouseClick_showLatLng(e) {
        popup
            .setLatLng(e.latlng)
            .setContent("You clicked the map at " + e.latlng.toString())
            .openOn(map);
    }

    map.on('click', onMouseClick_removeMarker);

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

        context.beginPath();
        context.moveTo(pad.x, pad.y);
        context.lineTo(canvas.width - pad.x, pad.y);
        context.lineTo(canvas.width - pad.x, canvas.height - pad.y);
        context.lineTo(pad.x, canvas.height - pad.y);
        context.closePath();
        context.stroke();

        var imageData = context.getImageData(0, 0, width, height);
        putImageData([_pos.lat, _pos.lng], width, height, coords, imageData);

        if (coverageLayer.rtree_cachedTile) {
            var result = coverageLayer.rtree_cachedTile.search(bb);
            result.sort(function(a, b) {
                var za = coverageLayer.getCoords(a[4]).z;
                var zb = coverageLayer.getCoords(b[4]).z;
                // console.log(za, zb);
                return za - zb;
            })


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
                coverageLayer.tilesNeedUpdate[id] = true;
            }

            console.log("length", ids.length, coverageLayer.tilesNeedUpdate);

            var removeTileInDB = function(id) {

                var promise = new Promise(function(resolve, reject) {
                    // console.log("removeTileInDB", id, db);
                    db.get(id).then(function(tile) {
                        // console.log("get tile", tile);
                        return db.remove(tile);
                    }).then(function(response) {
                        console.log("remove tile", response, id);
                        resolve();
                    }).catch(function(err) {
                        // console.log("Err", id, err);
                        resolve();
                    });
                });

                return promise;
            }

            var prev = Promise.resolve();

            Promise.all(ids.map(function(id) {
                removeTileInDB(id);
            })).then(function(id) {
                console.log("successfully remove markers");
            });
        }
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

        var x = (currentPoint.x / TILESIZE) >> 0;
        var y = (currentPoint.y / TILESIZE) >> 0;

        var coords = L.point(x, y);
        coords.z = zoom;
        var id = coverageLayer.getId(coords);

        var tile = coverageLayer.tiles.get(id);

        if (tile)
            bb = tile.bb;


        var nw = L.latLng(bb[2], bb[1]);
        var se = L.latLng(bb[0], bb[3]);
        var tl = map.project(nw, coords.z);
        var br = map.project(se, coords.z);

        var tl = tl.add(pad);
        var br = br.subtract(pad);
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

        var tileIds = getTileIDs(tilePoint, WIDTH, HEIGHT, coords);
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
