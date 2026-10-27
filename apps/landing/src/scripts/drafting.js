// Astrolabe · drafting
//
// Motion here plays once on arrival or answers the pointer, and every loop stops when it settles.
// One rAF, woken by scroll, maps scroll position to the effects that need it (the manifesto's ink,
// the thread figure, the header). With reduced motion every finished state
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
  layoutScrubs();
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

/* ───────────────────────────── Scrubbed figures: scroll carries a figure's progress, written to --p on
   its stage, and the CSS draws each mark in its own window of it (drafting.css, [04]). Only while the
   figure is active (wide screens with motion; static otherwise, at --p 1) and near the window. */

const scrubQuery = matchMedia("(min-width: 901px) and (min-height: 560px)");
const scrubs = [];
function scrub(host, box, stage, progress, onChange) {
  const figure = { host, stage, last: -1 };
  scrubs.push(figure);
  jobs.push((vh) => {
    if (!figure.on) return;
    const rect = box.getBoundingClientRect();
    if (rect.bottom < -vh || rect.top > vh * 1.5) return;
    const p = Math.round(clamp(progress(rect, vh)) * 1000) / 1000;
    if (p === figure.last) return;
    figure.last = p;
    stage.style.setProperty("--p", p);
    onChange?.(p);
  });
}
function layoutScrubs() {
  const on = motion && scrubQuery.matches;
  for (const figure of scrubs) {
    figure.on = on;
    figure.last = -1;
    figure.host.classList.toggle("is-scrubbed", on);
    if (!on) figure.stage.style.setProperty("--p", "1");
  }
  layoutStory();
}
scrubQuery.addEventListener("change", () => {
  layoutScrubs();
  requestFrame();
});

/* The thread figure: progress across a 300vh runway, pinned while it is scrubbed. */

const story = $("[data-story]");
const storyCount = story && $("[data-story-count]", story);
const storySteps = story ? $$(".story__steps li", story) : [];
let storyStep = -1;
const storyStages = [0.16, 0.32, 0.5, 0.66];
function layoutStory() {
  if (!story) return;
  story.classList.toggle("is-pinned", story.classList.contains("is-scrubbed"));
  storyStep = -1;
}
if (story) {
  // Starts as the stage rises into view, so it is never an empty field.
  const progress = (rect, vh) => (vh * 0.2 - rect.top) / (rect.height - vh + vh * 0.2);
  scrub(story, $(".story__runway", story), $(".story__stage", story), progress, (p) => {
    // The counter and the caption change together, at one threshold; one caption is always shown.
    const found = storyStages.findIndex((edge) => p < edge);
    const step = found === -1 ? storyStages.length : found;
    if (step === storyStep) return;
    storyStep = step;
    storyCount.textContent = `Stage ${step + 1} / 5`;
    storySteps.forEach((li, i) => li.classList.toggle("is-on", i === step));
  });
}

/* The automations' day: a playhead sweeps 00:00 to 24:00 as the figure's middle rises from 85% to
   35% of the window, not pinned; its readout shows the time to ten minutes. */

const day = $("[data-day]");
if (day) {
  const time = $("[data-day-time]", day);
  const progress = (rect, vh) => (vh * 0.85 - (rect.top + rect.height / 2)) / (vh * 0.5);
  scrub(day, day, day, progress, (p) => {
    const minutes = Math.round((p * 24 * 60) / 10) * 10;
    const text = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    if (time.textContent !== text) time.textContent = text;
  });
}

layoutScrubs();

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
