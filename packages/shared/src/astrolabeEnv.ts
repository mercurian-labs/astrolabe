/**
 * Astrolabe's code reads upstream T3 Code's `T3CODE_*` variables, and people set `ASTROLABE_*`.
 * Each entry point (server CLI, desktop main, dev runner) calls this once, before anything reads
 * the environment, so the rest of the code keeps upstream's names.
 *
 * - `ASTROLABE_X` sets `T3CODE_X`.
 * - `T3CODE_HOME`, `T3CODE_PORT` and `T3CODE_HOST` choose state and sockets, so values inherited
 *   from a shell set up for T3 Code are dropped. Otherwise Astrolabe could open T3 Code's database
 *   or take its port.
 *
 * The first Astrolabe process marks the environment, so a server that Astrolabe spawns keeps the
 * `T3CODE_*` values its parent set.
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
