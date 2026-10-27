#!/usr/bin/env node
// Share the installer's runtime cache; pre-0.0.41 services re-enter here over IPC.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Astrolabe: people set ASTROLABE_*, and this file reads T3CODE_*. The same
// mapping as packages/shared/src/astrolabeEnv.ts, inline because the launcher
// has no dependencies. The executable it starts inherits the result.
if (process.env.ASTROLABE_ENV_APPLIED !== "1") {
  for (const name of ["T3CODE_HOME", "T3CODE_PORT", "T3CODE_HOST"]) delete process.env[name];
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("ASTROLABE_"))
      process.env[`T3CODE_${key.slice("ASTROLABE_".length)}`] = value;
  }
  process.env.ASTROLABE_ENV_APPLIED = "1";
}

// Astrolabe: the build stamps CLI_RELEASE_REPOSITORY (packages/shared/src/cliRelease.ts)
// into package.json. Without it, and without a mirror, there is nothing to download.
const { version, astrolabe: { releaseRepository = "" } = {} } = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8"),
);
const releaseBaseUrl =
  process.env.T3CODE_RELEASE_BASE_URL ||
  (releaseRepository && `https://github.com/${releaseRepository}/releases/download`);

const SUPPORTED = ["darwin-arm64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"];

function t3Home() {
  const raw = (process.env.T3CODE_HOME || "").trim();
  if (raw === "") return path.join(os.homedir(), ".astrolabe");
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

async function get(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    throw new Error(
      `${url} does not exist yet. If ${version} was just released, try again in a few minutes.`,
    );
  }
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response;
}

async function download(url, file) {
  const response = await get(url);
  const total = Number(response.headers.get("content-length")) || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.openSync(file, "w");
  const tty = process.stderr.isTTY;
  let received = 0;
  let shown = -1;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      fs.writeSync(out, chunk);
      received += chunk.byteLength;
      // Redraw once per percent (or per MB without a length), not per chunk.
      const step = total ? Math.floor((received * 100) / total) : Math.floor(received / 1048576);
      if (tty && step !== shown) {
        shown = step;
        const percent = total ? ` ${step}%` : "";
        process.stderr.write(
          `\r\x1b[2Kastrolabe: downloading Astrolabe ${version}${percent} (${(received / 1048576).toFixed(1)} MB)`,
        );
      }
    }
  } finally {
    fs.closeSync(out);
    if (tty) process.stderr.write("\r\x1b[2K");
  }
  return hash.digest("hex");
}

async function install(dir, key) {
  const archive = `t3-${version}-${key}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
  const base = releaseBaseUrl.replace(/\/+$/, "");
  const sums = await (await get(`${base}/v${version}/SHA256SUMS`)).text();
  const expected = /^([0-9a-f]{64})\s+\*?(.+)$/im;
  const line = sums
    .split(/\r?\n/)
    .map((l) => expected.exec(l.trim()))
    .find((m) => m && m[2] === archive);
  if (!line) throw new Error(`${archive} is not listed in the release's SHA256SUMS`);

  // Stage beside the destination and rename atomically to avoid half-installed versions.
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const staging = fs.mkdtempSync(`${dir}.staging-`);
  try {
    const file = path.join(staging, archive);
    if ((await download(`${base}/v${version}/${archive}`, file)) !== line[1].toLowerCase()) {
      throw new Error(`checksum mismatch for ${archive}`);
    }
    // Windows' own tar.exe reads zip; a Git-for-Windows tar on PATH cannot.
    const tar =
      process.platform === "win32" ? `${process.env.SystemRoot}\\System32\\tar.exe` : "tar";
    const extract = spawnSync(tar, ["-xf", file, "-C", staging, "--strip-components=1"], {
      stdio: "inherit",
    });
    if (extract.status !== 0) throw new Error(`could not extract ${archive}`);
    fs.rmSync(file);
    fs.writeFileSync(path.join(staging, ".install-complete"), `${version}\n`);
    publish(staging, dir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const isComplete = (dir) => {
  try {
    return fs.readFileSync(path.join(dir, ".install-complete"), "utf8").trim() === version;
  } catch {
    return false;
  }
};

/** Preserve concurrently published complete installs; replace only incomplete folders without the completion marker. */
function publish(staging, dir) {
  try {
    fs.renameSync(staging, dir);
  } catch (error) {
    if (isComplete(dir)) return;
    if (!fs.existsSync(dir)) throw error;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
  }
}

async function main() {
  const key = `${process.platform}-${process.arch}`;
  // Releases ship macOS and Linux only for now. Drop this when the Windows jobs return to release.yml.
  if (process.platform === "win32") {
    throw new Error(
      "Astrolabe for Windows is coming soon. macOS and Linux builds are at https://astrolabe.sh/download",
    );
  }
  if (!SUPPORTED.includes(key)) {
    throw new Error(
      `no Astrolabe CLI build is available for ${key} (supported: ${SUPPORTED.join(", ")}).` +
        (releaseRepository
          ? `\nThe desktop app is at https://github.com/${releaseRepository}/releases`
          : ""),
    );
  }
  const dir = path.join(t3Home(), "runtime", "versions", version);
  if (!isComplete(dir)) {
    if (!releaseBaseUrl) {
      throw new Error(
        `Astrolabe publishes no release of ${version} to download yet. ` +
          "Set ASTROLABE_RELEASE_BASE_URL to a mirror of the release archives.",
      );
    }
    await install(dir, key);
  }

  // Service IPC and signals must reach the child; terminal Ctrl-C already does, so do not forward SIGINT twice.
  const ipc = process.send !== undefined;
  const child = spawn(
    path.join(dir, process.platform === "win32" ? "astrolabe.exe" : "astrolabe"),
    process.argv.slice(2),
    {
      stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
      // The executable lives in the T3 home, so this is how it knows npm launched it.
      env: { ...process.env, T3CODE_NPM_LAUNCHER_PATH: import.meta.filename },
    },
  );
  if (ipc) {
    process.on("message", (message) => child.connected && child.send(message));
    child.on("message", (message) => process.connected && process.send(message));
    process.on("disconnect", () => child.connected && child.disconnect());
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => (ipc || signal !== "SIGINT") && child.kill(signal));
  }
  child.on("error", (error) => fail(error));
  child.on("exit", (code, signal) =>
    process.exit(code ?? 128 + (os.constants.signals[signal] || 1)),
  );
}

function fail(error) {
  process.stderr.write(`astrolabe: ${error.message}\n`);
  process.exit(1);
}

await main().catch(fail);
