// The hero's tour: one controller plays tour-scenes.js over the drawn window (HeroWindow.astro). State
// is the shown parts (data-k) plus a few root attributes; starting a phase rebuilds it from every
// earlier event. One pending timeout and one transform animation drive playback, and nothing is
// scheduled once a scenario ends. Reduced motion shows each segment's finished state at once.

import { scenarios } from "./tour-scenes.js";

const ATTRIBUTES = new Set(["section", "thread", "cpane", "edits", "merge"]);
const SECTIONS = ["agents", "wikis", "changes"];

const tour = document.querySelector("[data-tour]");
const app = document.querySelector("[data-tour-app]");
if (tour && app) run(tour, app);

function run(tour, app) {
  const panel = app.closest(".panel") ?? app;
  const caption = tour.querySelector("[data-tour-caption]");
  const segments = [...tour.querySelectorAll("[data-tour-phase]")];
  const fills = segments.map((segment) => segment.querySelector("i span"));
  const tries = panel.querySelector("[data-tour-try]");
  const chips = tries ? [...tries.querySelectorAll("[data-try]")] : [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // Each part, under every key it answers to; a part shows while any of its keys is shown.
  const parts = new Map();
  for (const el of app.querySelectorAll("[data-k]")) {
    el.keys = el.dataset.k.split(" ");
    for (const key of el.keys) parts.set(key, [...(parts.get(key) ?? []), el]);
  }
  const owned = [...app.querySelectorAll("[data-only]")];
  const tabs = [...app.querySelectorAll("[data-tab]")];
  const rows = [...app.querySelectorAll("[data-row]")];
  const paneTabs = [...app.querySelectorAll("[data-cp]")];
  const shown = new Set();
  const played = new Set();

  let state = "poster";
  let scenario = 0;
  let phase = 0;
  let index = 0;
  let elapsed = 0;
  let startedAt = 0;
  let timer = 0;
  let fill = null;
  let seen = false;
  let visible = false;

  const phasesOf = (s) => scenarios[s].phases;

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

  // The thread on show: its parts, its tab in front, its row marked.
  function showThread(id) {
    for (const el of owned)
      el.toggleAttribute("data-off", !el.dataset.only.split(" ").includes(id));
    for (const tab of tabs) tab.classList.toggle("is-front", tab.dataset.tab === id);
    for (const tab of tabs) tab.classList.toggle("is-focus", tab.dataset.tab === id);
    for (const row of rows) row.classList.toggle("is-on", row.dataset.row === id);
  }

  function setAttribute(type, value) {
    app.dataset[type] = value;
    if (type === "thread") showThread(value);
    if (type === "cpane")
      for (const tab of paneTabs) {
        tab.classList.toggle("is-front", tab.dataset.cp === value);
        tab.classList.toggle("is-focus", tab.dataset.cp === value);
      }
  }

  function apply({ type, payload }, quiet) {
    if (ATTRIBUTES.has(type)) setAttribute(type, payload);
    else if (type === "show" || type === "hide") setKeys([payload].flat(), type === "show", quiet);
    else if (type === "swap") {
      setKeys([payload.from], false, quiet);
      setKeys([payload.to], true, quiet);
    } else if (type === "press" && !quiet) {
      for (const el of app.querySelectorAll(`[data-p="${payload}"]`)) {
        el.classList.remove("is-pressed");
        void el.offsetWidth;
        el.classList.add("is-pressed");
      }
    }
  }

  const applyAll = (s, to = phasesOf(s).length) => {
    for (const p of phasesOf(s).slice(0, to)) for (const e of p.events) apply(e, true);
  };

  // The window as it stands when phase `to` of scenario `s` begins: empty, then the main scenario
  // and any example already played (an example starts from a finished window), then every earlier
  // event of its own.
  function rebuild(s, to) {
    setKeys([...shown], false, true);
    for (const el of app.querySelectorAll(".is-pressed")) el.classList.remove("is-pressed");
    if (s !== 0) {
      applyAll(0);
      for (const other of played) if (other !== 0 && other !== s) applyAll(other);
    }
    applyAll(s, to);
  }

  /* ───────────── The clock: one timeout for the next event, one animation for the bar. */

  const clock = () => (state === "playing" ? elapsed + performance.now() - startedAt : elapsed);

  function tick() {
    clearTimeout(timer);
    timer = 0;
    if (state !== "playing") return;
    const { events, duration } = phasesOf(scenario)[phase];
    const t = clock();
    while (index < events.length && events[index].at <= t) apply(events[index++], false);
    const next = index < events.length ? events[index].at : duration;
    timer = setTimeout(index < events.length ? tick : advance, Math.max(0, next - t));
  }

  function advance() {
    timer = 0;
    if (phase + 1 < phasesOf(scenario).length) begin(phase + 1);
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
    showPhase();
    const { segment, duration } = phasesOf(scenario)[i];
    fill = fills[segment].animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration,
      easing: "linear",
      fill: "forwards",
    });
    if (state === "paused") fill.pause();
    tick();
  }

  // Play scenario s from phase i to its end, the window locked.
  function play(s, i) {
    scenario = s;
    played.add(s);
    rebuild(s, i);
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
    // Commit the fill as a style so no animation object outlives the tour.
    settleFills();
    explore();
  }

  function explore() {
    state = "exploring";
    lock(false);
  }

  /* ───────────── The bar, the caption, the chips, the lock. */

  // The segments mark the running phase's section: filled before it in the main scenario, empty
  // after; an example fills only its own.
  function settleFills() {
    const on = phasesOf(scenario)[phase].segment;
    fills.forEach((f, n) => {
      for (const a of f.getAnimations()) a.cancel();
      f.style.transform = `scaleX(${n === on || (scenario === 0 && n < on) ? 1 : 0})`;
    });
    fill = null;
  }

  function showPhase() {
    const { segment, caption: text } = phasesOf(scenario)[phase];
    segments.forEach((el, n) => {
      el.classList.toggle("is-on", n === segment);
      el.classList.toggle("is-done", scenario === 0 && n < segment);
      if (n === segment) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
      if (n !== segment) {
        for (const a of fills[n].getAnimations()) a.cancel();
        fills[n].style.transform = `scaleX(${scenario === 0 && n < segment ? 1 : 0})`;
      }
    });
    chips.forEach((chip, n) => chip.setAttribute("aria-pressed", String(n === scenario)));
    if (caption.textContent !== text) caption.textContent = text;
  }

  function lock(on) {
    app.toggleAttribute("inert", on);
    app.dataset.state = on ? "playing" : "exploring";
    tour.dataset.state = on ? "playing" : "ready";
    for (const segment of segments) segment.disabled = on;
    if (!tries) return;
    // The prompts appear once the main scenario has played, and stay.
    if (!on) tries.hidden = false;
    tries.dataset.state = on ? "playing" : "ready";
    for (const chip of chips) chip.disabled = on;
  }

  // Scenario s finished, on phase i, at once.
  function jump(s, i) {
    clearTimeout(timer);
    timer = 0;
    scenario = s;
    played.add(s);
    rebuild(s, phasesOf(s).length);
    turnTo(i);
    explore();
  }

  // Phase i's section, as the scenario left it.
  function turnTo(i) {
    phase = i;
    setAttribute("section", SECTIONS[phasesOf(scenario)[i].segment]);
    showPhase();
    settleFills();
  }

  const start = (s, i) => (reduced.matches ? jump(s, i) : play(s, i));

  segments.forEach((segment, i) =>
    segment.addEventListener("click", () => {
      if (state !== "exploring") return;
      start(0, i);
    }),
  );
  // An example "sends" its prompt: the window plays its scenario from the composer.
  chips.forEach((chip, n) =>
    chip.addEventListener("click", () => {
      if (state === "exploring") start(n, 0);
    }),
  );
  // "See it run" lands on the tour; once it has played, it plays the main scenario again.
  document.querySelector("[data-tour-run]")?.addEventListener("click", () => {
    if (state === "exploring") start(0, 0);
  });

  /* ───────────── Exploring: the rail switches sections; tabs and rows switch threads. */

  app.addEventListener("click", (event) => {
    if (state !== "exploring") return;
    const target = event.target.closest("[data-go], [data-tab], [data-row], [data-cp]");
    if (!target || (target.dataset.k && !target.keys.some((k) => shown.has(k)))) return;
    if (target.dataset.go) {
      const section = target.dataset.go;
      const i = phasesOf(scenario).findIndex((p) => SECTIONS[p.segment] === section);
      if (i >= 0) turnTo(i);
      else setAttribute("section", section);
    } else if (target.dataset.cp) setAttribute("cpane", target.dataset.cp);
    else setAttribute("thread", target.dataset.tab ?? target.dataset.row);
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
        play(0, 0);
      } else if (!visible) pause();
      else if (!document.hidden) resume();
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
    if (state !== "exploring") jump(scenario, state === "poster" ? 0 : phase);
  });

  if (reduced.matches) {
    jump(0, 0);
  } else {
    // Until it plays, the window waits on an empty thread before its first message.
    rebuild(0, 0);
    for (const e of phasesOf(0)[0].events) if (e.at === 0) apply(e, true);
    app.dataset.state = "poster";
    app.toggleAttribute("inert", true);
    tour.dataset.state = "poster";
    for (const segment of segments) segment.disabled = true;
    showPhase();
    fills[0].style.transform = "scaleX(0)";
  }
}
