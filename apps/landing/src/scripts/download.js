// Astrolabe · drafting · the download page
//
// Resolves every `[data-asset]` link against the latest release and tells the page which of four
// states it is in (data-release): pending while GitHub is asked, ready with a release, none before
// the first release, unavailable when GitHub can't be reached (the links stay on the releases page).
// The visitor's platform is read before the first paint by the page's inline script; this refines
// it with the architecture where the browser will say (Chromium on Windows and Linux).

import { NoRelease, RELEASES_URL, assetFor, fetchRelease } from "./releases.js";

const page = document.querySelector("[data-download]");
const links = [...page.querySelectorAll("a[data-asset]")];
const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const set = (name, text) => {
  for (const el of page.querySelectorAll(`[data-release-${name}]`)) el.textContent = text;
};

/* ───────────────────────────── The lead: one choice for the visitor's computer. */

function showLead() {
  const want = `${page.dataset.platform}${page.dataset.arch ? `-${page.dataset.arch}` : ""}`;
  const leads = [...page.querySelectorAll("[data-lead]")];
  const match =
    leads.find((lead) => lead.dataset.lead === want) ??
    leads.find((lead) => lead.dataset.lead === page.dataset.platform) ??
    leads.find((lead) => lead.dataset.lead === "other");
  for (const lead of leads) lead.hidden = lead !== match;
}

if (page.dataset.platform === "win" || page.dataset.platform === "linux") {
  navigator.userAgentData
    ?.getHighEntropyValues(["architecture"])
    .then(({ architecture }) => {
      if (architecture === "arm") {
        page.dataset.arch = "arm64";
        showLead();
      }
    })
    .catch(() => {});
}

/* ───────────────────────────── The release. */

async function load() {
  try {
    const release = await fetchRelease("stable");
    for (const link of links) link.href = assetFor(release, link.dataset.asset)?.url ?? release.url;
    for (const link of page.querySelectorAll("[data-release-link]")) link.href = release.url;
    set("version", release.tag);
    set("published", release.published ? dateFormat.format(new Date(release.published)) : "—");
    page.dataset.release = "ready";
  } catch (error) {
    if (error instanceof NoRelease) {
      // Nothing to download yet: the links stop being links rather than lead to an empty page.
      for (const link of links) {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      }
      set("version", "Not released yet");
      page.dataset.release = "none";
    } else {
      for (const link of links) link.href = RELEASES_URL;
      set("version", "See GitHub");
      page.dataset.release = "unavailable";
    }
    set("published", "—");
  }
}

load();

/* ───────────────────────────── Copy the command. */

for (const button of page.querySelectorAll("[data-copy]")) {
  const label = button.querySelector("[data-copy-label]");
  let timer;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      label.textContent = "Copied";
    } catch {
      label.textContent = "Select and copy";
    }
    clearTimeout(timer);
    timer = setTimeout(() => (label.textContent = "Copy"), 2000);
  });
}
