// Astrolabe · drafting
//
// Motion here plays once on arrival or answers the pointer, and every loop stops when it settles.
// One rAF, woken by scroll, maps scroll position to the effects that need it (the manifesto's ink,
// the thread figure, the surfaces' ink wipe, the header). With reduced motion every finished state
// shows at once and every interaction still works; without this script the page reads as a document.

const root = document.documentElement;
const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
let motion = !reducedQuery.matches;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];

reducedQuery.addEventListener("change", () => {
  motion = !reducedQuery.matches;
  root.classList.toggle("motion", motion);
  if (!motion) for (const a of document.getAnimations()) a.finish?.();
  layoutStory();
  requestFrame();
});

/* ───────────────────────────── The scroll frame: one listener, one rAF, a short list of jobs. */

const jobs = [];
let framePending = false;
function requestFrame() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    const vh = innerHeight;
    for (const job of jobs) job(vh);
  });
}
addEventListener("scroll", requestFrame, { passive: true });
addEventListener("resize", requestFrame);

/* ───────────────────────────── Once every section has been laid out (with the fonts), the ones off screen
   skip their style and paint (drafting.css): a twilight step then restyles only what is in view. */

addEventListener("load", () =>
  document.fonts.ready.then(() =>
    requestAnimationFrame(() => document.documentElement.classList.add("laid-out")),
  ),
);

/* ───────────────────────────── Header: hides going down past a few header heights, returns going up. */

const mast = $("[data-mast]");
const menuButton = $(".mast__menu");
const menu = $("#menu");
let lastY = scrollY;
jobs.push(() => {
  const y = scrollY;
  const height = mast.offsetHeight;
  const open = menuButton.getAttribute("aria-expanded") === "true";
  if (open || mast.contains(document.activeElement) || y < height * 3)
    mast.classList.remove("is-hidden");
  else if (y > lastY + 4) mast.classList.add("is-hidden");
  else if (y < lastY - 4) mast.classList.remove("is-hidden");
  lastY = y;
});
mast.addEventListener("focusin", () => mast.classList.remove("is-hidden"));

function setMenu(open) {
  menuButton.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
}
menuButton.addEventListener("click", () => setMenu(menu.hidden));
menu.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});
addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menu.hidden) {
    setMenu(false);
    menuButton.focus();
  }
});
matchMedia("(min-width: 961px)").addEventListener(
  "change",
  (event) => event.matches && setMenu(false),
);

/* ───────────────────────────── Entry reveals. */

const once = (targets, onEnter, options) => {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      onEnter(entry.target);
    }
  }, options);
  for (const target of targets) observer.observe(target);
};
once($$("[data-reveal]"), (el) => el.classList.add("is-in"), { threshold: 0.2 });

/* ───────────────────────────── The astrolabe's sighting: a crosshair, rulers and a readout of the true altitude
   and azimuth under the pointer, which instrument.js reads back through the plate's projection
   (window.astrolabeSight). With JavaScript and a fine pointer that hovers, the sighting mark is the
   pointer: CSS hides the system cursor while the field is sighting (.takes-cursor.is-sighting), the
   mark sits exactly on the pointer, and the guides and readout ease after it. Over the field's own
   controls (the Now button) the field stops sighting and the system cursor comes back; so it does
   when the pointer leaves, the window blurs or the tab hides. The instrument's hit areas (the rete's
   handle, its stars) are the instrument itself, so they keep the mark. Runs one rAF per pointer
   move while the guides settle, and nothing at rest. */

const field = $("[data-sight]");
if (field) {
  const sight = $(".sight", field);
  const parts = {
    h: $(".sight__h", sight),
    v: $(".sight__v", sight),
    mx: $(".sight__mx", sight),
    my: $(".sight__my", sight),
    line: $(".sight__rule line", sight),
    read: $(".sight__read", sight),
    mark: $(".sight__mark", sight),
  };
  const CONTROLS = "a[href], button, input, select, textarea, label, summary";
  const fineQuery = matchMedia("(hover: hover) and (pointer: fine)");
  const takeOver = () => field.classList.toggle("takes-cursor", fineQuery.matches && !!parts.mark);
  takeOver();
  fineQuery.addEventListener("change", takeOver);

  const target = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  const client = { x: 0, y: 0 };
  let box = null;
  let centre = null;
  let raf = 0;
  let lastText = "";
  let sighting = false;

  const measure = () => {
    box = field.getBoundingClientRect();
    const pin = window.astrolabeCentre?.();
    if (pin) {
      centre = { x: pin.x - box.left, y: pin.y - box.top };
      return;
    }
    const art = $(".sky__art", field).getBoundingClientRect();
    // The instrument's centre and horizon ring in its own drawing: (820, 1010), radius 712, of 1600 × 1800.
    centre = {
      x: art.left - box.left + (art.width * 820) / 1600,
      y: art.top - box.top + (art.height * 1010) / 1800,
      r: (art.width * 712) / 1600,
    };
  };
  const write = () => {
    // The mark is the pointer: exactly where it is, never eased.
    if (parts.mark) parts.mark.style.transform = `translate(${target.x}px, ${target.y}px)`;
    const { x, y } = now;
    parts.h.style.transform = `translateY(${y}px)`;
    parts.v.style.transform = `translateX(${x}px)`;
    parts.mx.style.transform = `translateX(${x}px)`;
    parts.my.style.transform = `translateY(${y}px)`;
    parts.line.setAttribute("x1", centre.x);
    parts.line.setAttribute("y1", centre.y);
    parts.line.setAttribute("x2", x);
    parts.line.setAttribute("y2", y);
    let text;
    if (window.astrolabeSight) {
      text = window.astrolabeSight(x + box.left, y + box.top) ?? lastText;
    } else {
      const dx = x - centre.x;
      const dy = y - centre.y;
      const zenith = 2 * Math.atan(Math.hypot(dx, dy) / centre.r);
      const alt = 90 - (zenith * 180) / Math.PI;
      const az = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      text = `ALT ${alt.toFixed(1)}° · AZ ${az.toFixed(1).padStart(5, "0")}°`;
    }
    if (text !== lastText) parts.read.textContent = lastText = text;
    parts.read.hidden = !text;
    // The readout sits below right of the pointer, and flips at the field's edges.
    const flipX = x > box.width - 230;
    const flipY = y > box.height - 60;
    parts.read.style.transform = `translate(${flipX ? x - 14 : x + 14}px, ${flipY ? y - 14 : y + 14}px) translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`;
  };
  const tick = () => {
    raf = 0;
    if (!sighting) return;
    const k = motion ? 0.35 : 1;
    now.x += (target.x - now.x) * k;
    now.y += (target.y - now.y) * k;
    if (Math.abs(target.x - now.x) < 0.1 && Math.abs(target.y - now.y) < 0.1) {
      now.x = target.x;
      now.y = target.y;
    } else raf = requestAnimationFrame(tick);
    write();
  };
  const leave = () => {
    sighting = false;
    field.classList.remove("is-sighting");
    cancelAnimationFrame(raf);
    raf = 0;
    box = null;
  };
  // A pointer at a client point: sight from it, or stop where it is off the field or on a control.
  const place = (x, y, onControl) => {
    client.x = x;
    client.y = y;
    if (!box) measure();
    target.x = x - box.left;
    target.y = y - box.top;
    const inside = target.x >= 0 && target.y >= 0 && target.x < box.width && target.y < box.height;
    if (!inside || onControl) return sighting && leave();
    if (!sighting) {
      // Arriving: the guides start on the pointer rather than easing in from where they last were.
      sighting = true;
      now.x = target.x;
      now.y = target.y;
      field.classList.add("is-sighting");
    }
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const onPointer = (event) => {
    if (event.pointerType === "touch") return;
    // While the rete turns the field holds the pointer, so the target is the field itself.
    place(event.clientX, event.clientY, !!event.target.closest?.(CONTROLS));
  };
  field.addEventListener("pointermove", onPointer);
  field.addEventListener("pointerleave", (event) => event.pointerType !== "touch" && leave());
  addEventListener("blur", leave);
  document.addEventListener("visibilitychange", () => document.hidden && leave());
  addEventListener("resize", () => (box = null));
  // Scrolling carries the field under a resting pointer, which sends no move; follow it from there.
  addEventListener(
    "scroll",
    () => {
      box = null;
      if (!sighting) return;
      const under = document.elementFromPoint(client.x, client.y);
      if (!under || !field.contains(under)) leave();
      else place(client.x, client.y, !!under.closest(CONTROLS));
    },
    { passive: true },
  );
}

/* ───────────────────────────── Manifesto: words darken from grey to ink as it scrolls through. */

const manifesto = $("[data-ink-words]");
if (manifesto && motion) {
  const words = manifesto.textContent.trim().split(/\s+/);
  manifesto.textContent = "";
  const spans = words.map((word, index) => {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = word;
    manifesto.append(span, index < words.length - 1 ? " " : "");
    return span;
  });
  let lit = -1;
  jobs.push((vh) => {
    const rect = manifesto.getBoundingClientRect();
    if (rect.bottom < -vh || rect.top > vh * 2) return;
    // From the paragraph's centre at the bottom of the window to its centre at 40% height.
    const centre = rect.top + rect.height / 2;
    const progress = motion ? clamp((vh * 1.05 - centre) / (vh * 0.65)) : 1;
    const count = Math.round(progress * spans.length);
    if (count === lit) return;
    spans.forEach((span, index) => span.classList.toggle("on", index < count));
    lit = count;
  });
}

/* ───────────────────────────── The thread figure: progress across a 300vh runway, pinned on wide
   screens with motion; a static stack otherwise. */

const story = $("[data-story]");
const stage = story && $(".story__stage", story);
const storyCount = story && $("[data-story-count]", story);
const storySteps = story ? $$(".story__steps li", story) : [];
let storyStep = -1;
const pinQuery = matchMedia("(min-width: 901px) and (min-height: 560px)");
const storyStages = [0.16, 0.32, 0.5, 0.66];
let storyLast = -1;
function layoutStory() {
  if (!story) return;
  const pinned = motion && pinQuery.matches;
  story.classList.toggle("is-pinned", pinned);
  if (!pinned) stage.style.setProperty("--p", "1");
  storyLast = -1;
  storyStep = -1;
}
pinQuery.addEventListener("change", () => {
  layoutStory();
  requestFrame();
});
layoutStory();
if (story) {
  const runway = $(".story__runway", story);
  jobs.push((vh) => {
    if (!story.classList.contains("is-pinned")) return;
    const rect = runway.getBoundingClientRect();
    if (rect.bottom < -vh || rect.top > vh * 1.5) return;
    // Starts as the stage rises into view, so it is never an empty field.
    const lead = vh * 0.2;
    const p = clamp((lead - rect.top) / (rect.height - vh + lead));
    const rounded = Math.round(p * 1000) / 1000;
    if (rounded === storyLast) return;
    storyLast = rounded;
    stage.style.setProperty("--p", rounded);
    // The counter and the caption change together, at one threshold; one caption is always shown.
    const found = storyStages.findIndex((edge) => rounded < edge);
    const step = found === -1 ? storyStages.length : found;
    if (step === storyStep) return;
    storyStep = step;
    storyCount.textContent = `Stage ${step + 1} / 5`;
    storySteps.forEach((li, i) => li.classList.toggle("is-on", i === step));
  });
}

/* ───────────────────────────── Surfaces: an ink wipe from the line sketch to the finished window,
   scrubbed by scroll. The mask is noise-displaced, so its edge reads as ink, not a circle. Once the
   window is fully revealed the mask comes off. */

let wipeId = 0;
for (const host of $$("[data-wipe]")) {
  const finished = $(".window", host);
  if (!finished) continue;
  // The sketch is the same window, outlined; it carries no meaning of its own.
  const sketch = finished.cloneNode(true);
  sketch.classList.add("window--sketch");
  sketch.setAttribute("aria-hidden", "true");
  sketch.inert = true;
  $$("[role], [aria-label]", sketch).forEach((el) => {
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
  });
  host.prepend(sketch);
  if (!motion) continue;

  const id = `wipe-mask-${++wipeId}`;
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "svg");
  defs.setAttribute("width", "0");
  defs.setAttribute("height", "0");
  defs.setAttribute("aria-hidden", "true");
  defs.style.position = "absolute";
  defs.innerHTML = `<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1" height="1"><g filter="url(#wipe-ink)"><circle r="0" fill="#fff" /></g></mask>`;
  host.append(defs);
  const mask = $("mask", defs);
  const circle = $("circle", defs);
  const [fx, fy] = (host.dataset.wipe || "0.5 0.5").split(" ").map(Number);
  let size = { w: 1, h: 1, r: 1 };
  const resize = () => {
    const w = finished.offsetWidth;
    const h = finished.offsetHeight;
    mask.setAttribute("width", w);
    mask.setAttribute("height", h);
    circle.setAttribute("cx", w * fx);
    circle.setAttribute("cy", h * fy);
    // Far enough to clear the farthest corner, edge noise included.
    size = { w, h, r: Math.hypot(Math.max(fx, 1 - fx) * w, Math.max(fy, 1 - fy) * h) + 90 };
    lastR = -1;
    requestFrame();
  };
  new ResizeObserver(resize).observe(finished);
  let lastR = -1;
  finished.style.mask = finished.style.webkitMask = `url(#${id})`;
  jobs.push((vh) => {
    const rect = finished.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > vh) {
      if (rect.top > vh && lastR !== 0) {
        finished.style.mask = finished.style.webkitMask = `url(#${id})`;
        circle.setAttribute("r", 0);
        lastR = 0;
      }
      return;
    }
    // From the window's top at the bottom of the screen to its middle at 45% height.
    const progress = motion ? clamp((vh * 0.95 - rect.top) / (rect.height * 0.5 + vh * 0.5)) : 1;
    const r = Math.round(progress * size.r);
    if (r === lastR) return;
    lastR = r;
    if (progress >= 1) {
      finished.style.mask = finished.style.webkitMask = "none";
    } else {
      finished.style.mask = finished.style.webkitMask = `url(#${id})`;
      circle.setAttribute("r", r);
    }
  });
}

/* ───────────────────────────── Moves: each drawing plays once on arrival, again on hover. */

const sims = $$("[data-sim]");
const playSim = (sim) => {
  if (!motion) return;
  sim.dataset.played = "true";
  for (const animation of sim.getAnimations({ subtree: true })) {
    animation.currentTime = 0;
    animation.play();
  }
};
const simRunning = (sim) =>
  sim.getAnimations({ subtree: true }).some((a) => a.playState === "running");
once(sims, playSim, { threshold: 0.55 });
for (const sim of sims) {
  sim.closest(".move").addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch" || !sim.dataset.played || simRunning(sim)) return;
    playSim(sim);
  });
}

// On small screens the moves are a scroll-snap row with a pager.
const moves = $("[data-moves]");
const pager = $("[data-pager]");
if (moves && pager) {
  const items = $$(".move", moves);
  const buttons = $$("button", pager);
  pager.hidden = false;
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const item = items[index];
      moves.scrollTo({
        left: item.offsetLeft - moves.offsetLeft,
        behavior: motion ? "smooth" : "auto",
      });
    });
  });
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = items.indexOf(entry.target);
        buttons.forEach((button, i) => button.setAttribute("aria-current", String(i === index)));
      }
    },
    { root: moves, threshold: 0.6 },
  );
  for (const item of items) observer.observe(item);
}

/* ───────────────────────────── Who it's for: one row open at a time. */

const who = $("[data-who]");
if (who) {
  const items = $$(".acc__item", who);
  items.forEach((item, index) => {
    const button = $(".acc__btn", item);
    button.addEventListener("click", () => {
      const opening = !item.classList.contains("is-open");
      items.forEach((other, i) => {
        const open = opening && i === index;
        other.classList.toggle("is-open", open);
        $(".acc__btn", other).setAttribute("aria-expanded", String(open));
      });
    });
  });
}

requestFrame();
