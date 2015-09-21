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

    console.log(maxwidth, maxheight);

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
