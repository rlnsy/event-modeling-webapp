"use strict";
importScripts("routing.js");
self.onmessage = ({ data: { edges, boxes } }) => {
  try {
    self.postMessage({ routes: ConnectorRouting.route(edges, boxes) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
