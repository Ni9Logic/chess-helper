/* eslint-disable no-restricted-globals */

// Load the lite WASM build (placed in /public alongside this worker).
importScripts("/stockfish-18-lite.js");

let engine;
try {
  // @ts-ignore Stockfish is exposed globally by the imported script
  engine = Stockfish({
    locateFile: (path) => (path.endsWith(".wasm") ? "/stockfish-18-lite.wasm" : path),
  });
} catch (error) {
  self.postMessage({ error: error?.message || String(error) });
}

const forward = (line) => {
  self.postMessage({ line });
};

if (engine) {
  if (typeof engine.addMessageListener === "function") {
    engine.addMessageListener(forward);
  } else {
    engine.onmessage = (event) => forward(event?.data ?? event);
  }

  self.onmessage = (event) => {
    const { cmd } = event.data || {};
    if (!cmd) return;
    if (cmd === "init") {
      engine.postMessage("uci");
      engine.postMessage("isready");
      return;
    }
    engine.postMessage(cmd);
  };
}
