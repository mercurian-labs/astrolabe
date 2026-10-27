// Astrolabe · share cards · the instrument (see instrument.html for the query).

import { done, fonts, params, wings } from "./frame.js";

// The ground paints once relight.js has its data and the instrument's moment: the card is done at
// its first draw.
const drawn = new Promise((resolve) => {
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const draw = proto.drawArrays;
    proto.drawArrays = function (...args) {
      draw.apply(this, args);
      resolve();
    };
  }
});

wings(params.get("line") ?? "");

done(
  (async () => {
    await fonts();
    await import("/src/scripts/relight.js");
    await import("/src/scripts/instrument.js");
    await Promise.all([drawn, document.querySelector(".mark").decode()]);
  })(),
);
