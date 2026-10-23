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
