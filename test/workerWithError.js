self.addEventListener('message', function(e) {
  postMessage(1/x); // Intentional error.
});