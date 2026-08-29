import * as NodeFSP from "node:fs/promises";

const indexPath = new URL("../dist/astrolabe.html", import.meta.url);
const indexHtml = await NodeFSP.readFile(indexPath, "utf8");

const scriptTags = indexHtml.match(/<script\b[^>]*>[\s\S]*?<\/script>/giu) ?? [];

function isAstroIslandScript(tag) {
  const openingTag = tag.match(/^<script\b[^>]*>/iu)?.[0];
  if (openingTag === undefined) return false;

  const isAstroModule =
    /\btype=(['"])module\1/iu.test(openingTag) &&
    /\bsrc=(['"])\/_astro\/[^'"]+\1/iu.test(openingTag);
  const isAstroOnlyHydration =
    /\(self\.Astro\|\|\(self\.Astro=\{\}\)\)\.only=/u.test(tag) &&
    /window\.dispatchEvent\(new Event\((['"])astro:only\1\)\)/u.test(tag);
  const isAstroIslandHydration = /customElements\.define\((['"])astro-island\1/iu.test(tag);
  const isAstroInlineHydration =
    openingTag.toLowerCase() === "<script>" && (isAstroOnlyHydration || isAstroIslandHydration);

  return isAstroModule || isAstroInlineHydration;
}

const offendingTag = scriptTags.find((tag) => !isAstroIslandScript(tag));

if (offendingTag !== undefined) {
  console.error(`Landing page contains a non-island script:\n${offendingTag}`);
  process.exitCode = 1;
} else {
  console.log("Landing page script guard passed: every script hydrates an Astro island.");
}
