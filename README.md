Very simple custom Express server/middleware for live-reloading. It injects a type="module" script tag before </body>, and that script just does simple polling to a namespaced (/dev/) pseudo-API url to check the last time the source files were modified. The server replies based on a Chokidar file watcher.