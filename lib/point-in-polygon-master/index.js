function pointInPoly(currentLatLng, vertexsL) {
    // ray-casting algorithm based on
    // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
    
    var x = currentLatLng.lat, y = currentLatLng.lng;
    
    var inside = false;
    for (var i = 0, j = vertexsL.length - 1; i < vertexsL.length; j = i++) {
        var xi = vertexsL[i].lat, yi = vertexsL[i].lng;
        var xj = vertexsL[j].lat, yj = vertexsL[j].lng;
        
        var intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    
    return inside;
};
