/**
 * People set `ASTROLABE_*`; the code reads upstream's `T3CODE_*`. Each entry point calls this once,
 * before anything reads the environment: `ASTROLABE_X` sets `T3CODE_X`, and inherited `T3CODE_HOME`,
 * `_PORT` and `_HOST` are dropped so Astrolabe never opens T3 Code's database or takes its port. The
 * first process marks the environment, so a server Astrolabe spawns keeps its parent's values.
 */
const PREFIX = "ASTROLABE_";
const APPLIED = "ASTROLABE_ENV_APPLIED";
const STATE_VARIABLES = ["T3CODE_HOME", "T3CODE_PORT", "T3CODE_HOST"] as const;

export function applyAstrolabeEnv(env: Record<string, string | undefined>): void {
  if (env[APPLIED] === "1") return;
  for (const name of STATE_VARIABLES) delete env[name];
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(PREFIX) && value !== undefined) {
      env[`T3CODE_${key.slice(PREFIX.length)}`] = value;
    }
  }
  env[APPLIED] = "1";
}
