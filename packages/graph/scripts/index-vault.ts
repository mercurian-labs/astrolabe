// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off - A one-shot host script: it reads a vault from disk and writes one JSON fixture.
/**
 * Index a vault into an Atlas Graph fixture; never writes into the vault. Only top-level files are
 * read, and each note's last change comes from the vault's git history when it has one.
 *   node scripts/index-vault.ts <vault-dir> [out-file] [memory-id]
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { indexVault, isNoteFile, isSkillMapFile, type VaultFile } from "../src/model/vault.ts";

const [vaultArg, outArg, idArg] = process.argv.slice(2);
if (vaultArg === undefined) {
  console.error("usage: node scripts/index-vault.ts <vault-dir> [out-file] [memory-id]");
  process.exit(2);
}
const vaultDir = NodePath.resolve(vaultArg);
const packageDir = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const outFile = NodePath.resolve(outArg ?? NodePath.join(packageDir, "fixtures", "almagest.json"));
if (outFile.startsWith(vaultDir + NodePath.sep)) {
  console.error("refusing to write inside the vault");
  process.exit(2);
}

function lastChanged(fileName: string): string | undefined {
  try {
    const out = NodeChildProcess.execFileSync(
      "git",
      ["-C", vaultDir, "log", "-1", "--format=%cs", "--", fileName],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

const files: Array<VaultFile> = NodeFS.readdirSync(vaultDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && (isNoteFile(entry.name) || isSkillMapFile(entry.name)))
  .map((entry) => entry.name)
  .toSorted()
  .map((fileName) => {
    const text = NodeFS.readFileSync(NodePath.join(vaultDir, fileName), "utf8");
    const changed = isNoteFile(fileName) ? lastChanged(fileName) : undefined;
    return changed === undefined ? { fileName, text } : { fileName, text, lastChanged: changed };
  });

const memory = indexVault(idArg ?? NodePath.basename(outFile, ".json"), files);
NodeFS.writeFileSync(outFile, `${JSON.stringify(memory, null, 2)}\n`);
const frontier = memory.notes.filter((note) => note.frontier).length;
console.log(
  `${outFile}: ${memory.notes.length - frontier} notes, ${frontier} red links, ` +
    `${memory.links.length} links, ${memory.lenses.length} lenses`,
);
