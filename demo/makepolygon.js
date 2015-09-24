function makeVPolygon(width, height) {
    var random = Math.floor(Math.random() * 2);
    var num = random + 3; //3 hoac 4 diem
    var scale = 10;

    var a = 10 * scale;

    var polygon = [];

    var first = {
        x: Math.floor(Math.random() * width) + a,
        y: Math.floor(Math.random() * height) + a,
    };

    var second = {
        x: first.x + Math.floor(Math.random() * 5 * scale) + 4 * scale,
        y: first.y + Math.floor(Math.random() * 5 * scale) + 6 * scale
    };

    var third = {
        x: first.x - Math.floor(Math.random() * 5 * scale) - 5 * scale,
        y: first.y + Math.floor(Math.random() * 5 * scale) + 4 * scale
    };

    if (num == 4) {
        var forth = {
            x: third.x + Math.floor(Math.random() * 5 * scale) + 6 * scale,
            y: third.y + Math.floor(Math.random() * 5 * scale) + 5 * scale,
        }

        polygon.push(forth);
    }

    polygon.push(second);
    polygon.push(first);
    polygon.push(third);

    return polygon;
}

function makeVPolygon2(lat, lng, maxwidth, maxheight) {
    var random = Math.floor(Math.random() * 2);
    var num = random + 3; //3 hoac 4 diem
    var scale = 10;

    var a = 10 * scale;

    var polygon = [];

    var first = {
        x: lat,
        y: lng,
    };

    maxwidth = 20.80618784724327 - 20.803620355329002;
    maxheight = 106.05514526367189 - 106.02767944335939;

    // console.log(maxwidth, maxheight);

    var w = maxwidth / 2;
    var h = maxheight / 2;
    var hw = w / 2;
    var hh = h / 2;

    var second = {
        x: first.x + Math.random() * hw + hw,
        y: first.y + Math.random() * hh + hh
    };

    var third = {
        x: first.x - Math.random() * hw - hw,
        y: first.y + Math.random() * hh + hh
    };

    if (num == 4) {
        var forth = {
            x: third.x + Math.random() * hw + hw,
            y: third.y + Math.random() * hh + hh
        }

        polygon.push(forth);
    }

    polygon.push(second);
    polygon.push(first);
    polygon.push(third);

    return polygon;
}

function makeVPolygonKientn2(lat, lng, zoom, count2G, count3G, rssi, ecno, rscp) {
    var num = 4; // 4 diem
    var polygon = [];
    var average2G = rssi / count2G;
    var color;
    if (average2G > -77) {
        color = "rgba(233,20,1,1)";
    } else if (average2G < -77 && average2G > -90) {
        color = "rgba(20,1,2,1)";
    } else {
        color = "rgba(2,11,111,1)";
    }
    var first = {
        x: lat - zoom / 2,
        y: lng - zoom / 2,
        c: color,
    };
    var second = {
        x: lat - zoom / 2,
        y: lng + zoom / 2,
        //c: color,
    };
    var third = {
        x: lat + zoom / 2,
        y: lng + zoom / 2,
        //c: color,
    };
    var forth = {
        x: lat + zoom / 2,
        y: lng - zoom / 2,
        //c: color,
    }
    polygon.push(first);
    polygon.push(second);
    polygon.push(third);
    polygon.push(forth);
    //polygon.push(color);
    return polygon;
}

function makeVPolygonKientn2_backup(lat, lng, zoom, count2G, count3G, rssi, ecno, rscp) {
    var zoomIndex = {
        '6': 0.02, //160
        '7': 0.01, //80
        '8': 0.005, //40
        '9': 0.0025, //20
        '10': 0.00125, //10
        '11': 0.000625, //5
        '12': 0.000375, //3
        '13': 0.00025, //2
        '14': 0.000125, //1
        '15': 0.000125,
        '16': 0.000125,
        '17': 0.000125,
        '18': 0.000125
    };
    var num = 4; // 4 diem
    var average2G = rssi / count2G;
    var color;
    if (average2G > -77) {
        color = "rgba(233,20,1,1)";
    } else if (average2G < -77 && average2G > -90) {
        color = "rgba(255,248,1,1)";
    } else {
        color = "rgba(23,23,0,1)";
    }
    var polygon = [];
    var first = {
        x: lat - zoomIndex['' + zoom],
        y: lng - zoomIndex['' + zoom],
        c: color,
    };
    var second = {
        x: lat - zoomIndex['' + zoom],
        y: Number.parseFloat(lng) + Number.parseFloat(zoomIndex['' + zoom]),
    };
    var third = {
        x: Number.parseFloat(lat) + zoomIndex['' + zoom],
        y: Number.parseFloat(lng) + zoomIndex['' + zoom],
    };
    var forth = {
        x: Number.parseFloat(lat) + zoomIndex['' + zoom],
        y: lng - zoomIndex['' + zoom],
    }
    polygon.push(first);
    polygon.push(second);
    polygon.push(third);
    polygon.push(forth);
    return polygon;
}


function makeBPolygons() {
    var canvas = drawPolygon('#8ED6FF');
    poly.canvas = canvas;
}


function drawPolygon(color) {
    var canvas = document.createDocument('canvas');
    var context = canvas.getContext('2d');

    context.stranslate(-130, -5);

    context.beginPath();
    context.moveTo(170, 80);
    context.bezierCurveTo(130, 100, 130, 150, 230, 150);
    context.bezierCurveTo(250, 180, 320, 180, 340, 150);
    context.bezierCurveTo(420, 150, 420, 120, 390, 100);
    context.bezierCurveTo(430, 40, 370, 30, 340, 50);
    context.bezierCurveTo(320, 5, 250, 20, 250, 50);
    context.bezierCurveTo(200, 5, 150, 20, 170, 80);

    // complete custom shape
    context.closePath();
    context.lineWidth = 5;
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = 'blue';
    context.stroke();

    return canvas;
}
