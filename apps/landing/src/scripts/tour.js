// The hero's tour: one controller plays the scene data in tour-scenes.js over the drawn window
// (components/HeroWindow.astro).
//
// The window's state is a set of shown parts (data-k) plus a few attributes on its root: the rail's
// section, the thread on show, the pane a phone shows. Each event changes that state; replaying from
// a phase rebuilds it from every event before. One pending timeout waits for the next event, and the
// running segment's fill is one transform animation that pauses with it. Once the last phase ends
// nothing is scheduled and nothing animates.
//
// States: poster (waiting to be seen), playing, paused (out of view or a hidden tab), complete (the
// last phase ended), exploring (unlocked: the rail and thread rows answer, each segment replays).
// With reduced motion it never plays: a segment shows its phase's finished state at once.

import { phases } from "./tour-scenes.js";

const ATTRIBUTES = new Set(["section", "focus", "thread", "edits", "merge"]);

const tour = document.querySelector("[data-tour]");
const app = document.querySelector("[data-tour-app]");
if (tour && app) run(tour, app);

function run(tour, app) {
  const panel = app.closest(".panel") ?? app;
  const caption = tour.querySelector("[data-tour-caption]");
  const segments = [...tour.querySelectorAll("[data-tour-phase]")];
  const fills = segments.map((segment) => segment.querySelector("i span"));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // Each part, under every key it answers to; a part shows while any of its keys is shown.
  const parts = new Map();
  for (const el of app.querySelectorAll("[data-k]")) {
    el.keys = el.dataset.k.split(" ");
    for (const key of el.keys) parts.set(key, [...(parts.get(key) ?? []), el]);
  }
  const shown = new Set();
  const sections = phases.map((p) => p.events.find((e) => e.type === "section").payload);

  let state = "poster";
  let phase = 0;
  let index = 0;
  let elapsed = 0;
  let startedAt = 0;
  let timer = 0;
  let fill = null;
  let seen = false;
  let visible = false;

  /* ───────────── Events. `quiet` applies one without its entrance (rebuilding, reduced motion). */

  function setKeys(keys, on, quiet) {
    for (const key of keys) on ? shown.add(key) : shown.delete(key);
    for (const key of keys) {
      for (const el of parts.get(key) ?? []) {
        const now = el.keys.some((k) => shown.has(k));
        if (now && !el.classList.contains("is-shown")) el.classList.toggle("is-quiet", quiet);
        el.classList.toggle("is-shown", now);
      }
    }
  }

  function apply({ type, payload }, quiet) {
    if (ATTRIBUTES.has(type)) app.dataset[type] = payload;
    else if (type === "show" || type === "hide") setKeys([payload].flat(), type === "show", quiet);
    else if (type === "swap") {
      setKeys([payload.from], false, quiet);
      setKeys([payload.to], true, quiet);
    } else if (type === "step" || type === "files") setKeys([payload.key], true, quiet);
    else if (type === "press" && !quiet) {
      for (const el of app.querySelectorAll(`[data-p="${payload}"]`)) {
        el.classList.remove("is-pressed");
        void el.offsetWidth;
        el.classList.add("is-pressed");
      }
    }
  }

  // The window as it stands when phase `to` begins: empty, then every earlier event at once.
  function rebuild(to) {
    setKeys([...shown], false, true);
    for (const el of app.querySelectorAll(".is-pressed")) el.classList.remove("is-pressed");
    for (const p of phases.slice(0, to)) for (const e of p.events) apply(e, true);
  }

  /* ───────────── The clock: one timeout for the next event, one animation for the bar. */

  const clock = () => (state === "playing" ? elapsed + performance.now() - startedAt : elapsed);

  function tick() {
    clearTimeout(timer);
    timer = 0;
    if (state !== "playing") return;
    const { events, duration } = phases[phase];
    const t = clock();
    while (index < events.length && events[index].at <= t) apply(events[index++], false);
    const next = index < events.length ? events[index].at : duration;
    timer = setTimeout(index < events.length ? tick : advance, Math.max(0, next - t));
  }

  function advance() {
    timer = 0;
    if (phase + 1 < phases.length) begin(phase + 1);
    else finish();
  }

  function begin(i) {
    clearTimeout(timer);
    fill?.cancel();
    phase = i;
    index = 0;
    elapsed = 0;
    startedAt = performance.now();
    state = visible && !document.hidden ? "playing" : "paused";
    showPhase(i);
    fill = fills[i].animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration: phases[i].duration,
      easing: "linear",
      fill: "forwards",
    });
    if (state === "paused") fill.pause();
    tick();
  }

  // Play from phase i to the end, the window locked.
  function play(i) {
    rebuild(i);
    lock(true);
    begin(i);
  }

  function pause() {
    if (state !== "playing") return;
    elapsed = clock();
    state = "paused";
    clearTimeout(timer);
    timer = 0;
    fill?.pause();
  }

  function resume() {
    if (state !== "paused") return;
    state = "playing";
    startedAt = performance.now();
    fill?.play();
    tick();
  }

  function finish() {
    state = "complete";
    // Commit the fill as a style so no animation object outlives the tour.
    settleFills(phase);
    explore();
  }

  function explore() {
    state = "exploring";
    lock(false);
  }

  /* ───────────── The bar, the caption, the lock. */

  function settleFills(i) {
    fills.forEach((f, n) => {
      for (const a of f.getAnimations()) a.cancel();
      f.style.transform = `scaleX(${n <= i ? 1 : 0})`;
    });
    fill = null;
  }

  function showPhase(i) {
    segments.forEach((segment, n) => {
      segment.classList.toggle("is-on", n === i);
      segment.classList.toggle("is-done", n < i);
      if (n === i) segment.setAttribute("aria-current", "step");
      else segment.removeAttribute("aria-current");
      if (n !== i) {
        for (const a of fills[n].getAnimations()) a.cancel();
        fills[n].style.transform = `scaleX(${n < i ? 1 : 0})`;
      }
    });
    if (caption.textContent !== phases[i].caption) caption.textContent = phases[i].caption;
  }

  function lock(on) {
    app.toggleAttribute("inert", on);
    app.dataset.state = on ? "playing" : "exploring";
    tour.dataset.state = on ? "playing" : "ready";
    for (const segment of segments) segment.disabled = on;
  }

  // The finished window, on phase i's section, at once.
  function jump(i) {
    clearTimeout(timer);
    timer = 0;
    rebuild(phases.length);
    turnTo(i);
    explore();
  }

  function turnTo(i) {
    app.dataset.section = sections[i];
    phase = i;
    showPhase(i);
    settleFills(i);
  }

  segments.forEach((segment, i) =>
    segment.addEventListener("click", () => {
      if (state === "playing" || state === "paused") return;
      if (reduced.matches) jump(i);
      else play(i);
    }),
  );

  /* ───────────── Exploring: the rail switches between the phases' ends; thread rows answer. */

  app.addEventListener("click", (event) => {
    if (state !== "exploring") return;
    const go = event.target.closest("[data-go]");
    const row = event.target.closest("[data-row]");
    if (go) turnTo(sections.indexOf(go.dataset.go));
    else if (row && (!row.dataset.k || shown.has(row.dataset.k)))
      app.dataset.thread = row.dataset.row;
  });

  /* ───────────── When to play: once, when the window is well in view; pause when it isn't. */

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      const ratio = entry.intersectionRatio;
      const enough = ratio >= 0.5 || entry.intersectionRect.height >= innerHeight * 0.6;
      visible = entry.isIntersecting && ratio >= 0.15;
      if (!seen && enough && !document.hidden && !reduced.matches) {
        seen = true;
        play(0);
      } else if (!visible) pause();
      else resume();
    },
    { threshold: [0, 0.15, 0.3, 0.5, 0.7, 1] },
  );
  observer.observe(panel);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (visible) resume();
  });

  reduced.addEventListener("change", () => {
    if (!reduced.matches) return;
    seen = true;
    if (state !== "exploring") jump(state === "poster" ? 0 : phase);
  });

  if (reduced.matches) {
    jump(0);
  } else {
    // Until it plays, the window waits on the thread before its first message.
    rebuild(0);
    for (const e of phases[0].events) if (e.at === 0) apply(e, true);
    app.dataset.state = "poster";
    app.toggleAttribute("inert", true);
    tour.dataset.state = "poster";
    for (const segment of segments) segment.disabled = true;
    showPhase(0);
    fills[0].style.transform = "scaleX(0)";
  }
}
