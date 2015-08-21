import(node_modules/pouchdb-3.6.0.min.js);


self.addEventListener('message', function(e) {
    console.log("Worker: ", e.data);

    var data = e.data;
    var id = data.id;
    var name = data.name;
    var rev = data.rev;
    var blob = data.blob;
    var type = data.type;

    count = 0;
    db.putAttachment(id, name, rev, blob, type, function(e, r) {
        if (e) {
            if (e.status === 409 && count++ < 20) {
                console.log("Stored blob", e);
                retryUntilWritten(id, name, rev, blob, type, callback);
            } else console.log("Error ", e);
        } else {
            // console.log("Store blob successfully", r);
            if (callback) callback(r);
        }
    });

});
