import type { LanguageServerToolchainOption } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * Finding a checkout's Python interpreters, and the machine's Java. Nothing here runs one: an
 * untrusted checkout's interpreter is its code. Versions come from what's on disk beside them.
 */

const VENV_FOLDERS = [".venv", "venv"];
const VENV_INTERPRETERS = ["bin/python", "Scripts/python.exe"];
const CONDA_FOLDERS = ["miniconda3", "anaconda3", "miniforge3", "mambaforge", ".conda"];
const CONDA_INSTALLS = ["/opt/anaconda3", "/opt/homebrew/Caskroom/miniconda/base"];
const HOMEBREW_ROOTS = ["/opt/homebrew", "/usr/local"];
const JVM_FOLDER = "/usr/lib/jvm";
const OPTIONS_LISTED = 100;

export const checkoutInterpreters = (path: Path.Path, cwd: string) =>
  VENV_FOLDERS.flatMap((folder) =>
    VENV_INTERPRETERS.map((interpreter) => path.join(cwd, folder, interpreter)),
  );

const versionIn = (name: string) => /\d+\.\d+(?:\.\d+)?/.exec(name)?.[0] ?? null;

interface Found extends LanguageServerToolchainOption {
  /** A virtual environment's interpreter links to its base, and isn't the same choice. */
  readonly isolated: boolean;
}

/** Java installed where package managers leave it off PATH, newest name first. Runs none. */
export const findJavaInstalls = Effect.fn("LanguageServers.findJavaInstalls")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const list = (folder: string) =>
    fileSystem.readDirectory(folder).pipe(
      Effect.map((names) => names.toSorted().toReversed()),
      Effect.orElseSucceed((): Array<string> => []),
    );
  const installs: Array<string> = [];
  for (const root of HOMEBREW_ROOTS) {
    const opt = path.join(root, "opt");
    for (const name of yield* list(opt)) {
      if (name.startsWith("openjdk")) installs.push(path.join(opt, name, "bin/java"));
    }
  }
  for (const name of yield* list(JVM_FOLDER)) {
    installs.push(path.join(JVM_FOLDER, name, "bin/java"));
  }
  return installs;
});

export const findPythonInterpreters = Effect.fn("LanguageServers.findPythonInterpreters")(
  function* (input: {
    readonly cwd: string;
    readonly home: string | null;
    readonly platform: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { cwd, home, platform, environment } = input;
    const exists = (file: string) =>
      fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));
    const list = (folder: string) =>
      fileSystem.readDirectory(folder).pipe(Effect.orElseSucceed((): Array<string> => []));
    const inHome = (...parts: ReadonlyArray<string>) =>
      home === null ? [] : [path.join(home, ...parts)];
    const found: Array<Found> = [];
    const add = (option: Found) => void found.push(option);

    /** A virtual environment's interpreter, with what its `pyvenv.cfg` says of it. */
    const addVenv = Effect.fnUntraced(function* (folder: string, label: string) {
      for (const interpreter of VENV_INTERPRETERS) {
        const file = path.join(folder, interpreter);
        if (!(yield* exists(file))) continue;
        const config = yield* fileSystem
          .readFileString(path.join(folder, "pyvenv.cfg"))
          .pipe(Effect.orElseSucceed(() => ""));
        const made = /^uv\s*=/m.test(config) ? " (uv)" : "";
        const version = /^version(?:_info)?\s*=\s*(\d+\.\d+(?:\.\d+)?)/m.exec(config)?.[1] ?? null;
        add({ path: file, label: `${label}${made}`, version, isolated: true });
        return;
      }
    });

    /** Each subfolder's interpreter, labelled and versioned by the subfolder's name. */
    const addEach = Effect.fnUntraced(function* (
      folder: string,
      interpreter: string,
      label: (name: string) => string,
      isolated = false,
    ) {
      for (const name of (yield* list(folder)).toSorted()) {
        const file = path.join(folder, name, interpreter);
        if (yield* exists(file)) {
          add({ path: file, label: label(name), version: versionIn(name), isolated });
        }
      }
    });

    for (const folder of VENV_FOLDERS) yield* addVenv(path.join(cwd, folder), folder);
    // Any other folder of the checkout that is a virtual environment, however it was named.
    for (const name of (yield* list(cwd)).toSorted()) {
      if (VENV_FOLDERS.includes(name)) continue;
      if (yield* exists(path.join(cwd, name, "pyvenv.cfg"))) {
        yield* addVenv(path.join(cwd, name), name);
      }
    }

    const condas = [
      ...new Set([
        ...(environment.CONDA_PREFIX === undefined ? [] : [environment.CONDA_PREFIX]),
        ...CONDA_FOLDERS.flatMap((folder) => inHome(folder)),
        ...CONDA_INSTALLS,
      ]),
    ];
    for (const conda of condas) {
      const interpreter = path.join(conda, "bin/python");
      if (yield* exists(interpreter)) {
        const meta = (yield* list(path.join(conda, "conda-meta"))).find((name) =>
          name.startsWith("python-3"),
        );
        add({
          path: interpreter,
          label: `conda ${path.basename(conda)}`,
          version: meta === undefined ? null : versionIn(meta),
          isolated: true,
        });
      }
      yield* addEach(path.join(conda, "envs"), "bin/python", (name) => `conda ${name}`, true);
    }

    const pyenv = environment.PYENV_ROOT ?? inHome(".pyenv")[0];
    if (pyenv !== undefined) {
      yield* addEach(path.join(pyenv, "versions"), "bin/python", (name) => `pyenv ${name}`);
    }
    for (const uv of inHome(".local/share/uv/python")) {
      yield* addEach(uv, "bin/python3", (name) => `uv ${versionIn(name) ?? name}`);
    }
    for (const root of HOMEBREW_ROOTS) {
      const opt = path.join(root, "opt");
      // Newest first, and `python@3.14` before `python@3`, its link: that one says its version.
      for (const name of (yield* list(opt)).toSorted().toReversed()) {
        if (!name.startsWith("python@")) continue;
        const file = path.join(opt, name, "bin/python3");
        if (yield* exists(file)) {
          add({
            path: file,
            label: `Homebrew ${name.slice("python@".length)}`,
            version: versionIn(name),
            isolated: false,
          });
        }
      }
    }
    // macOS's /usr/bin/python3 is a shim that offers to install Xcode's tools when run.
    const system =
      platform === "darwin"
        ? ["/Library/Developer/CommandLineTools/usr/bin/python3"]
        : ["/usr/local/bin/python3", "/usr/bin/python3"];
    for (const file of system) {
      if (yield* exists(file)) {
        add({ path: file, label: "System", version: null, isolated: false });
      }
    }

    const seen = new Set<string>();
    const options: Array<LanguageServerToolchainOption> = [];
    for (const { isolated, ...option } of found) {
      const key = isolated
        ? option.path
        : yield* fileSystem.realPath(option.path).pipe(Effect.orElseSucceed(() => option.path));
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(option);
    }
    return options.slice(0, OPTIONS_LISTED);
  },
);
