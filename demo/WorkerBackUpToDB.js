if ('undefined' === typeof window) {

    importScripts('pouchdb-4.0.0.min.js');


    self.addEventListener('message', function(e) {
        var data = e.data;
        var id = data.id;
        var name = data.name;
        var rev = data.rev;
        var blob = data.blob;
        var type = data.type;
        var db = new PouchDB("vmts");

        function retryUntilWritten(id, name, rev, blob, type) {

            var count = 0;
            db.putAttachment(id, name, rev, blob, type, function(e, r) {
                if (e) {
                    if (e.status === 409 && count++ < 20) {
                        console.log("Worker Stored blob", e);
                        retryUntilWritten(id, name, rev, blob, type);
                        // self.close();
                    } else {
                        console.log("Worker Error ", e);
                        self.close();
                    }
                } else {
                    console.log("Worker Store blob successfully", r);             
                    self.close();       
                }
            });
        }

        retryUntilWritten(id, name, rev, blob, type);
        // self.close();
    });


}
