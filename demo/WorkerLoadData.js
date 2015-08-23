if ('undefined' === typeof window) {

    importScripts('data.js');


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

    var start = new Date();

    var ab = new ArrayBuffer(1);

    postMessage(ab, [ab]);

    if (ab.byteLength) {
        alert('Transferables are not supported in your browser!');
        postMessage({
            'flag': -1,  //browser not support webworker
            'data': dataset,
            'bb':BBAllPointLatlng,
        });
    } else {    
        postMessage({
            'data': buffer,
            'bb': BBAllPointLatlng
        }, [buffer]);
    };    

    var end = new Date();
    console.log("Time Send: ", end - start, "milliseconds");

}
