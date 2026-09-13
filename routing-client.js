/* Latest-layout-only worker ownership and bounded geometry cache. */
(function (root) {
  "use strict";
  class ConnectorRoutingClient {
    constructor(makeWorker = () => new Worker("routing-worker.js"), timeoutMs = 10000) {
      this.makeWorker = makeWorker;
      this.timeoutMs = timeoutMs;
      this.cache = new Map();
      this.pending = null;
    }

    cancel() {
      if (this.pending) this.pending.finish(new Error("Routing cancelled"));
    }

    request(edges, boxes) {
      // Include every obstacle, endpoint, edge order and kind. Scrolling does
      // not change these row-relative coordinates; edits and growth do.
      const key = JSON.stringify([edges, Object.keys(boxes).sort().map(id => [id, boxes[id]])]);
      if (this.pending?.key === key) return this.pending.promise;
      this.cancel();
      if (this.cache.has(key)) {
        const routes = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, routes);
        return Promise.resolve(routes);
      }
      const job = { key };
      job.promise = new Promise((resolve, reject) => {
        let worker, timer, finished = false;
        job.finish = (error, routes) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          worker?.terminate();
          if (this.pending === job) this.pending = null;
          if (error) { reject(error); return; }
          this.cache.set(key, routes);
          if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
          resolve(routes);
        };
        this.pending = job;
        try {
          worker = this.makeWorker();
          worker.onmessage = event => {
            if (event.data.error) job.finish(new Error(event.data.error));
            else job.finish(null, event.data.routes);
          };
          worker.onerror = () => job.finish(new Error("Routing worker failed"));
          timer = setTimeout(() => job.finish(new Error("Routing time limit reached")), this.timeoutMs);
          worker.postMessage({ edges, boxes });
        } catch (error) { job.finish(error); }
      });
      return job.promise;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = ConnectorRoutingClient;
  else root.ConnectorRoutingClient = ConnectorRoutingClient;
})(globalThis);
