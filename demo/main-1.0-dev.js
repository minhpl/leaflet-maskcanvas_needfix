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
        radius: red_canvas.width,
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
            // console.log("Here");
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

        var i = ~~ (x + (y * TILESIZE));
        var location = (i << 2) + 3;

        var alpha = buffer.uint8[location]
            // var color = ImageBuffer.createColor();
            // buffer.getPixel(i,color);
            // if (color.a) return color.a;

        return (!alpha) ? -1 : alpha;
    }

    var MEM;

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
        minX = (minX < 0) ? (minX - 0.5) >> 0 : (minX + 0.5) >> 0;
        minY = (minY < 0) ? (minY - 0.5) >> 0 : (minY + 0.5) >> 0;


        // var maxX = Math.round(centrePoint[0] + w+2*w);
        var maxX = minX + WIDTH;
        // var maxY = Math.round(centrePoint[1] + h+2*h);
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
        //


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
        var alph = (tile) ? alpha(tilePoint, tile.canvas) : -1;

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

        var tileIDs = [getID(zoom, tileIDX, tileIDY)];
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
                drawImage(ctx,img, tilePoint[0] - w, tilePoint[1] - h);
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
        function f(){
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
                    drawImage(self.ctx,self.img, minX, minY);
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
                                            drawImage(self.ctx,self.img, minX, minY);
                                        } else {
                                            self.img.src = self.img.src;
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

            }

            result.push(o);
        }

        return result;
    }

    var count = 0;

    var insidePoly = false;

    function onMouseMove(e) {
        // coverageLayer.backupOne();
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
                WIDTH = HEIGHT = radius;
                var imgs = cropImgBoxs(info.topPointlatlng, WIDTH, HEIGHT, info.coords);
                info.img = imgs;
                // console.log("Draw ",++count);
                var WIDTH, HEIGHT;
                WIDTH = HEIGHT = radius;
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

        return TopPoint;
    }

    function onMouseClick(e) {
        var currentPositionPoint = map.project(e.latlng);
        var Points = circleCentrePointCover(currentPositionPoint);
        if (!isInsideObject) {
            alert("Not inside object");
            return;
        }
        var TopPoint = getTopPoint(Points);
        if (!TopPoint) return;
        var latLng = new L.LatLng(TopPoint[0], TopPoint[1]);
        var message = latLng.toString();
        popup.setLatLng(latLng).setContent(message).openOn(map);
    }

    $('.leaflet-container').css('cursor', 'auto');

    map.on('mousemove', onMouseMove);

    function onMapClick(e) {
        popup
            .setLatLng(e.latlng)
            .setContent("You clicked the map at " + e.latlng.toString())
            .openOn(map);
    }

    map.on('click', onMapClick);


    // map.on('click', onMouseClick);
});