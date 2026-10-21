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

/* ───────────────────────────── Entry reveals and the problem diagrams on small screens. */

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
once($$("[data-draw]"), (el) => el.classList.add("is-drawn"), { threshold: 0.4 });
if (matchMedia("(max-width: 900px)").matches) {
  once($$(".pcard"), (el) => el.classList.add("is-drawn"), { threshold: 0.6 });
}

/* ───────────────────────────── The astrolabe's sighting: a crosshair, rulers and a readout of the true altitude
   and azimuth under the pointer, which instrument.js reads back through the plate's projection
   (window.astrolabeSight). Runs only while the pointer moves; stops when it settles or leaves. */

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
  };
  const target = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  let box = null;
  let centre = null;
  let raf = 0;
  let lastText = "";

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
    const k = motion ? 0.3 : 1;
    now.x += (target.x - now.x) * k;
    now.y += (target.y - now.y) * k;
    if (Math.abs(target.x - now.x) < 0.1 && Math.abs(target.y - now.y) < 0.1) {
      now.x = target.x;
      now.y = target.y;
    } else raf = requestAnimationFrame(tick);
    write();
  };
  field.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    measure();
    now.x = target.x = event.clientX - box.left;
    now.y = target.y = event.clientY - box.top;
    write();
    field.classList.add("is-sighting");
  });
  field.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    if (!box) measure();
    target.x = event.clientX - box.left;
    target.y = event.clientY - box.top;
    if (!field.classList.contains("is-sighting")) field.classList.add("is-sighting");
    if (!raf) raf = requestAnimationFrame(tick);
  });
  field.addEventListener("pointerleave", () => {
    field.classList.remove("is-sighting");
    cancelAnimationFrame(raf);
    raf = 0;
    box = null;
  });
  addEventListener("scroll", () => (box = null), { passive: true });
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

/* ───────────────────────────── Footer wordmark: under the pointer, an ink lens reveals the solid
   mark over its outline, with a faint second lens lagging behind. The rAF stops once it settles. */

const inkMark = $("[data-ink-mark]");
if (inkMark && matchMedia("(hover: hover)").matches) {
  const svg = $("svg", inkMark);
  const lens = $(".mark__lens", svg);
  const lag = $(".mark__lag", svg);
  const RADIUS = 0.45 * 250 * 1.25;
  const state = {
    target: { x: 500, y: 125 },
    lens: { x: 500, y: 125, r: 0 },
    lag: { x: 500, y: 125, r: 0, o: 0 },
    goal: 0,
    from: { r: 0, lagR: 0, o: 0 },
    start: 0,
    duration: 1,
  };
  let raf = 0;
  const toLocal = (event) => {
    const rect = svg.getBoundingClientRect();
    const scale = 1000 / rect.width;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (time) => {
    raf = 0;
    const t = motion ? clamp((time - state.start) / state.duration) : 1;
    const k = ease(t);
    state.lens.r = state.from.r + (state.goal * RADIUS - state.from.r) * k;
    state.lag.r = state.from.lagR + (state.goal * RADIUS * 1.05 - state.from.lagR) * k;
    state.lag.o = state.from.o + (state.goal * 0.2 - state.from.o) * k;
    const follow = motion ? 0.1 : 1;
    const trail = motion ? 0.06 : 1;
    state.lens.x += (state.target.x - state.lens.x) * follow;
    state.lens.y += (state.target.y - state.lens.y) * follow;
    state.lag.x += (state.target.x - state.lag.x) * trail;
    state.lag.y += (state.target.y - state.lag.y) * trail;
    lens.setAttribute("cx", state.lens.x.toFixed(1));
    lens.setAttribute("cy", state.lens.y.toFixed(1));
    lens.setAttribute("r", state.lens.r.toFixed(1));
    lag.setAttribute("cx", state.lag.x.toFixed(1));
    lag.setAttribute("cy", state.lag.y.toFixed(1));
    lag.setAttribute("r", state.lag.r.toFixed(1));
    lag.setAttribute("opacity", state.lag.o.toFixed(3));
    const moving =
      Math.abs(state.target.x - state.lag.x) > 0.3 || Math.abs(state.target.y - state.lag.y) > 0.3;
    if (t < 1 || moving) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const tweenTo = (goal, duration) => {
    state.from = { r: state.lens.r, lagR: state.lag.r, o: state.lag.o };
    state.goal = goal;
    state.start = performance.now();
    state.duration = duration;
    wake();
  };
  svg.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    const point = toLocal(event);
    state.target = point;
    // Enter where the pointer is, rather than sliding in from the last place it left.
    if (state.lens.r < 1) {
      Object.assign(state.lens, point);
      Object.assign(state.lag, point);
    }
    tweenTo(1, 550);
  });
  svg.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    state.target = toLocal(event);
    wake();
  });
  svg.addEventListener("pointerleave", () => tweenTo(0, 800));
}

requestFrame();
