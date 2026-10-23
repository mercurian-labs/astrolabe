// Astrolabe · share cards · the instrument (see instrument.html for the query).

import { done, fonts, params } from "./frame.js";

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

// The line either side of the instrument, each half on two lines: "Chart the / course." and
// "Build / together.".
const line = params.get("line") ?? "";
const halves = [line.slice(0, line.indexOf(". ") + 1), line.slice(line.indexOf(". ") + 2)];
for (const [el, half] of [
  [document.querySelector(".wing--left"), halves[0]],
  [document.querySelector(".wing--right"), halves[1]],
]) {
  const at = half.lastIndexOf(" ");
  el.append(half.slice(0, at), document.createElement("br"), half.slice(at + 1));
}

done(
  (async () => {
    await fonts();
    await import("/src/scripts/relight.js");
    await import("/src/scripts/instrument.js");
    await Promise.all([drawn, document.querySelector(".mark").decode()]);
  })(),
);
