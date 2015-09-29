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
    const REALDATA = false;
    const serverAdress = 'http://10.61.64.118:9000';

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
        opacity: 1,
        radius: RADIUS,
        useAbsoluteRadius: false,
        debug: true,
        map: map,
        boundary: true,
        img_on: img_blueCircle,
    });

    var coverageLayer2 = new L.GridLayer.MaskCanvas({
        opacity: 1,
        radius: RADIUS,
        useAbsoluteRadius: false,
        debug: false,
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
        // coverageLayer.setDataCell(celldata);

        var zoom = map.getZoom();

        var socket = io.connect(serverAdress);
        socket.on('connect', function() {
            socket.emit("get_coverage_info", {
                zoom_level: zoom,
                mnc: 4,
                boundary: {
                    lat1: 10,
                    lat2: 30,
                    lng1: 100,
                    lng2: 130
                }
            });
        });

        socket.on('get_coverage_info', function(data) {
            var aryData = data;

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
            var socket = io.connect(serverAdress);

            socket.on('connect', function() {
                socket.emit("get_coverage_info", {
                    zoom_level: zoom,
                    mnc: 4,
                    boundary: {
                        lat1: 10,
                        lat2: 30,
                        lng1: 100,
                        lng2: 130
                    }
                });
            });

            socket.on('get_coverage_info', function(data) {
                var aryData = data;
                var dPoly = [];
                var id = 0;

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

        coverageLayer2.setDataPoly();
        coverageLayer2.setDataCell(celldata);
    }

    map.addLayer(coverageLayer);
    map.addLayer(coverageLayer2);

    //crop images at Position
    map.on('mousemove', onMouseMove);

    function onMouseMove(e) {
        coverageLayer.onMouseMove(e);
        coverageLayer2.onMouseMove(e);
    }

    map.on('contextmenu', onContextMenu);

    map.on('click', onContextMenu);

    function onContextMenu(e) {

        coverageLayer2.setOpacity(0);
        coverageLayer2.redraw();

        var info = coverageLayer.lastRecentInfo;
        console.log("onContextMenu poly info", info.poly, info.polyID);
        console.log("onContextMenu cell info", info.cell, info.cellID);

        info = coverageLayer2.lastRecentInfo;
        console.log("onContextMenu poly info2", info.poly, info.polyID);
        console.log("onContextMenu cell info2", info.cell, info.cellID);
    }

});
