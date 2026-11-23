// The hero's tour: one controller plays tour-scenes.js over the drawn window (HeroWindow.astro). State
// is the shown parts (data-k) plus a few root attributes; starting a phase rebuilds it from every
// earlier event. Phase buttons and example prompts stay interactive at all times, a compact toggle
// pauses/resumes/replays playback, and clicking directly inside the window pauses for exploration.

import { scenarios } from "./tour-scenes.js";

const ATTRIBUTES = new Set(["section", "thread", "cpane", "edits", "merge", "beat", "evidence"]);
const SECTIONS = ["agents", "story", "wikis", "agents"];
const INTERACTIVE =
  '[data-go], [data-tab], [data-row], [data-cp], [data-beat], [data-beat-step], [data-cite], [data-evidence-close], [data-keep-wiki], [data-p="switch"]';

const tour = document.querySelector("[data-tour]");
const app = document.querySelector("[data-tour-app]");
if (tour && app) run(tour, app);

function run(tour, app) {
  const panel = app.closest(".panel") ?? app;
  const caption = tour.querySelector("[data-tour-caption]");
  const segments = [...tour.querySelectorAll("[data-tour-phase]")];
  const fills = segments.map((segment) => segment.querySelector("i span"));
  const toggle = tour.querySelector("[data-tour-toggle]");
  const toggleLabel = toggle?.querySelector("[data-tour-toggle-label]");
  const toggleUse = toggle?.querySelector("use");
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
  let userPaused = false;

  const phasesOf = (s) => scenarios[s].phases;

  /* ───────────── Events. `quiet` applies one without its entrance (rebuilding, reduced motion). */

  function setKeys(keys, on, quiet) {
    for (const key of keys) {
      if (on) shown.add(key);
      else shown.delete(key);
    }
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

  function pulse(key) {
    for (const el of app.querySelectorAll(`[data-p="${key}"]`)) {
      el.classList.remove("is-pressed");
      void el.offsetWidth;
      el.classList.add("is-pressed");
    }
  }

  function apply({ type, payload }, quiet) {
    if (ATTRIBUTES.has(type)) setAttribute(type, payload);
    else if (type === "show" || type === "hide") setKeys([payload].flat(), type === "show", quiet);
    else if (type === "swap") {
      setKeys([payload.from], false, quiet);
      setKeys([payload.to], true, quiet);
    } else if (type === "press" && !quiet) {
      pulse(payload);
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

  // Ensure a section has populated content if the visitor explores it before its phase runs.
  function ensureSectionPopulated(section) {
    if (section === "story") {
      if (!app.dataset.beat) setAttribute("beat", "3");
      if (!shown.has("story-keep-btn") && !shown.has("story-kept")) {
        setKeys(["story-keep-btn"], true, true);
      }
    } else if (section === "wikis") {
      if (!shown.has("old") && !shown.has("ghost") && !shown.has("ins-1")) {
        setAttribute("edits", "accepted");
        setKeys(["ins-1", "ins-2", "ins-3"], true, true);
      }
    } else if (section === "changes") {
      if (!shown.has("pr1-open") && !shown.has("pr1-merged")) {
        setAttribute("cpane", "group");
        setAttribute("merge", "off");
        setKeys(
          ["grp-groups", "grp-sync", "pr1-open", "pr2-open", "cr-open", "cr-st-open", "chk-pass"],
          true,
          true,
        );
      }
    }
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
    state = visible && !document.hidden && !userPaused ? "playing" : "paused";
    syncState();
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

  // Play scenario s from phase i to its end. Phase buttons and prompts stay clickable throughout.
  function play(s, i) {
    userPaused = false;
    scenario = s;
    played.add(s);
    rebuild(s, i);
    begin(i);
  }

  function pause(byUser = false) {
    if (byUser) userPaused = true;
    if (state !== "playing") {
      syncState();
      return;
    }
    elapsed = clock();
    state = "paused";
    clearTimeout(timer);
    timer = 0;
    fill?.pause();
    syncState();
  }

  function resume() {
    if (state !== "paused") return;
    userPaused = false;
    state = "playing";
    startedAt = performance.now();
    syncState();
    fill?.play();
    tick();
  }

  function finish() {
    // Commit the fill as a style so no animation object outlives the tour.
    settleFills();
    explore();
  }

  function explore() {
    userPaused = false;
    state = "exploring";
    syncState();
  }

  /* ───────────── The bar, the caption, the toggle, the chips. */

  function syncToggle() {
    if (!toggle || !toggleLabel || !toggleUse) return;
    let mode = "play";
    let label = "Play";
    let aria = "Play tour";
    let pressed = false;
    if (state === "playing") {
      mode = "pause";
      label = "Pause";
      aria = "Pause tour";
    } else if (state === "paused" && userPaused) {
      mode = "play";
      label = "Play";
      aria = "Resume tour";
      pressed = true;
    } else if (state === "exploring") {
      mode = "replay";
      label = "Replay";
      aria = "Replay tour";
    }
    toggleLabel.textContent = label;
    toggleUse.setAttribute("href", `#i-${mode}`);
    toggle.setAttribute("aria-label", aria);
    toggle.setAttribute("aria-pressed", String(pressed));
  }

  function syncState() {
    const tourState =
      state === "playing"
        ? "playing"
        : state === "paused"
          ? "paused"
          : state === "poster"
            ? "poster"
            : "ready";
    app.dataset.state = state;
    tour.dataset.state = tourState;
    if (tries) tries.dataset.state = tourState;
    syncToggle();
  }

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

  // Scenario s finished, on phase i, at once (reduced motion).
  function jump(s, i) {
    clearTimeout(timer);
    timer = 0;
    fill?.cancel();
    fill = null;
    scenario = s;
    played.add(s);
    rebuild(s, phasesOf(s).length);
    phase = i;
    if (s === 0) {
      const targetSection = SECTIONS[phasesOf(s)[i].segment];
      setAttribute("section", targetSection);
      if (targetSection === "story") {
        setAttribute("beat", "3");
        setAttribute("evidence", "intents");
      }
    }
    showPhase();
    settleFills();
    explore();
  }

  const start = (s, i) => {
    seen = true;
    userPaused = false;
    if (reduced.matches) jump(s, i);
    else play(s, i);
  };

  // Phase buttons and example prompt chips are always clickable, even mid-playback.
  segments.forEach((segment, i) =>
    segment.addEventListener("click", () => {
      start(0, i);
    }),
  );
  chips.forEach((chip, n) =>
    chip.addEventListener("click", () => {
      start(n, 0);
    }),
  );
  // "See it run" lands on the tour and starts the main scenario from phase 1.
  document.querySelector("[data-tour-run]")?.addEventListener("click", () => {
    start(0, 0);
  });
  toggle?.addEventListener("click", () => {
    if (state === "playing") pause(true);
    else if (state === "paused") {
      seen = true;
      if (reduced.matches) jump(scenario, phase);
      else resume();
    } else if (state === "poster") {
      start(scenario, phase);
    } else {
      start(scenario, 0);
    }
  });

  /* ───────────── Exploring: rail, tabs, rows, story beats, cited evidence cards, switches. */

  function syncPhaseForSection(section) {
    if (state !== "exploring") return;
    if (scenario === 0) {
      if (section === "story") phase = 1;
      else if (section === "wikis" || section === "changes") phase = 2;
      else if (section === "agents") phase = shown.has("plan-skill-ask") ? 3 : 0;
      showPhase();
      settleFills();
    }
  }

  app.addEventListener("click", (event) => {
    // Clicking the staged Send button in poster state starts the tour immediately.
    if (state === "poster") {
      if (event.target.closest('[data-p="send"]')) start(0, 0);
      return;
    }

    const target = event.target.closest(INTERACTIVE);
    if (!target || (target.dataset.k && !target.keys.some((k) => shown.has(k)))) return;

    // Clicking an interactive control mid-playback pauses the tour so the visitor can explore.
    if (state === "playing") pause(true);

    if (target.dataset.go) {
      const section = target.dataset.go;
      ensureSectionPopulated(section);
      setAttribute("section", section);
      syncPhaseForSection(section);
    } else if (target.dataset.cp) {
      setAttribute("cpane", target.dataset.cp);
    } else if (target.dataset.beat) {
      setAttribute("beat", target.dataset.beat);
    } else if (target.dataset.beatStep) {
      const current = Number(app.dataset.beat || 1);
      const next = Math.min(3, Math.max(1, current + Number(target.dataset.beatStep)));
      setAttribute("beat", String(next));
    } else if (target.dataset.cite) {
      const cite = target.dataset.cite;
      setAttribute("evidence", cite);
      pulse(`cite-${cite}`);
    } else if ("evidenceClose" in target.dataset) {
      setAttribute("evidence", "none");
    } else if ("keepWiki" in target.dataset) {
      pulse("keep-wiki");
      setKeys(["story-keep-btn"], false, false);
      setKeys(["story-kept"], true, false);
    } else if (target.dataset.p === "switch") {
      pulse("switch");
      setAttribute("merge", app.dataset.merge === "on" ? "off" : "on");
    } else if (target.dataset.tab || target.dataset.row) {
      setAttribute("section", "agents");
      setAttribute("thread", target.dataset.tab ?? target.dataset.row);
      syncPhaseForSection("agents");
    }
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
      } else if (!visible) {
        if (state === "playing") pause(false);
      } else if (!document.hidden && state === "paused" && !userPaused) {
        resume();
      }
    },
    { threshold: [0, 0.15, 0.3, 0.5, 0.7, 1] },
  );
  observer.observe(panel);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (state === "playing") pause(false);
    } else if (visible && state === "paused" && !userPaused) {
      resume();
    }
  });

  reduced.addEventListener("change", () => {
    if (!reduced.matches) return;
    seen = true;
    if (state !== "exploring") jump(scenario, state === "poster" ? 0 : phase);
  });

  if (reduced.matches) {
    jump(0, 0);
  } else {
    // Richer poster state: show the first prompt staged in the composer and the thread in the sidebar.
    rebuild(0, 0);
    setAttribute("section", "agents");
    setAttribute("thread", "plan");
    setAttribute("beat", "1");
    setAttribute("evidence", "none");
    setKeys(["draft-apple", "plan-row", "plan-st-now"], true, true);
    state = "poster";
    syncState();
    showPhase();
    fills[0].style.transform = "scaleX(0)";
  }
}
