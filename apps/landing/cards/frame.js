// Astrolabe · share cards · the frame every card shares, and the handshake with the renderer.

export const params = new URLSearchParams(location.search);

const html = (markup) => {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
};

// The ruled frame and a registration cross at each of its corners.
export function frame(card) {
  card.append(html(`<div class="frame"></div>`));
  for (const corner of ["tl", "tr", "bl", "br"])
    card.append(
      html(
        `<svg class="cross cross--${corner}" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 0V22M0 11H22" /></svg>`,
      ),
    );
}

export function caption(card, corner, markup) {
  const el = html(`<p class="cap cap--${corner}"></p>`);
  el.innerHTML = markup;
  card.append(el);
  return el;
}

// Sets the largest font size up to `max` at which the line fits `width` on one line.
export function fit(el, width, max) {
  let size = max;
  el.style.fontSize = `${size}px`;
  while (el.scrollWidth > width && size > 8) {
    size -= 0.5;
    el.style.fontSize = `${size}px`;
  }
  return size;
}

// Sets the line either side of the picture, each half on two lines. It splits at the first full
// stop, or at the space nearest the middle when the line is one sentence.
export function wings(line) {
  const stop = line.indexOf(". ");
  const at = stop >= 0 ? stop + 1 : middleSpace(line);
  for (const [el, half] of [
    [document.querySelector(".wing--left"), line.slice(0, at).trim()],
    [document.querySelector(".wing--right"), line.slice(at).trim()],
  ]) {
    const space = half.lastIndexOf(" ");
    el.append(half.slice(0, space), document.createElement("br"), half.slice(space + 1));
  }
}

function middleSpace(line) {
  let best = line.length;
  for (let i = line.indexOf(" "); i >= 0; i = line.indexOf(" ", i + 1)) {
    if (Math.abs(i - line.length / 2) < Math.abs(best - line.length / 2)) best = i;
  }
  return best;
}

export async function fonts() {
  await Promise.all([
    document.fonts.load('380 40px "Fraunces"'),
    document.fonts.load('500 15px "Plex Mono"'),
  ]);
  await document.fonts.ready;
}

// The renderer waits on `window.card`: it resolves once the pixels are final, or rejects.
export function done(work) {
  window.card = work.then(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  window.card.catch((error) => console.error(error));
}
