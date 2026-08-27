import * as NodeFSP from "node:fs/promises";

const indexPath = new URL("../dist/index.html", import.meta.url);
const indexHtml = await NodeFSP.readFile(indexPath, "utf8");

if (indexHtml.includes("<script")) {
  console.error("Landing page must remain static: dist/index.html contains a <script tag.");
  process.exitCode = 1;
} else {
  console.log("Static landing page guard passed: dist/index.html contains no <script tags.");
}
