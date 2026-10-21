import { describe, expect, it } from "vite-plus/test";

import { extractFile, type FileFacts } from "./extract.ts";

const symbol = (facts: FileFacts, id: string) => facts.symbols.find((found) => found.id === id);
/** One kind of reference, as `from kind qualifier.name`. */
const referencesOf = (facts: FileFacts, kinds: ReadonlyArray<string>) =>
  facts.references
    .filter((reference) => kinds.includes(reference.kind))
    .map(
      (reference) =>
        `${reference.from.slice(reference.from.indexOf("#") + 1)} ${reference.kind} ${reference.qualifier === null ? "" : `${reference.qualifier}.`}${reference.name}`,
    );

describe("contracts", () => {
  it("reads TypeScript signatures, JSDoc, annotated types, and throws", async () => {
    const facts = await extractFile(
      "src/a.ts",
      "typescript",
      `/**
 * Loads a model.
 * Second line of the summary.
 *
 * More detail.
 * @param source where from
 */
export async function load(source: Lib.Source, options?: Map<string, Options>): Promise<Model> {
  const cache: Cache = new Cache();
  throw new LoadError("no");
}

class Store {
  /** Saves it. */
  save(model: Model): void {}
}

export const pick = (models: Array<Model>): Model => models[0];
`,
    );
    expect(symbol(facts, "src/a.ts#function:load")).toMatchObject({
      signature:
        "async function load(source: Lib.Source, options?: Map<string, Options>): Promise<Model>",
      doc: "Loads a model. Second line of the summary.",
    });
    expect(symbol(facts, "src/a.ts#method:Store.save")).toMatchObject({
      signature: "save(model: Model): void",
      doc: "Saves it.",
    });
    expect(symbol(facts, "src/a.ts#function:pick")?.signature).toBe(
      "pick = (models: Array<Model>): Model",
    );
    expect(symbol(facts, "src/a.ts#class:Store")).toMatchObject({ signature: "class Store" });
    expect(symbol(facts, "src/a.ts#class:Store")?.doc).toBeUndefined();
    expect(referencesOf(facts, ["accepts", "returns", "throws", "types"])).toEqual([
      // A type used in the body is a mention, not the contract.
      "function:load types Cache",
      "function:load accepts Lib.Source",
      "function:load accepts Map",
      "function:load accepts Options",
      "function:load returns Promise",
      "function:load returns Model",
      "method:Store.save accepts Model",
      "function:pick accepts Array",
      "function:pick accepts Model",
      "function:pick returns Model",
      "function:load throws LoadError",
    ]);
  });

  it("reads Python signatures, docstrings, annotated types, raises, and excepts", async () => {
    const facts = await extractFile(
      "pkg/a.py",
      "python",
      `def run(self, model: Model, retries: int = 2, *rest) -> mod.Result:
    """Run it once.

    More text."""
    try:
        raise ConfigError("bad")
    except (KeyError, errors.Oops) as e:
        raise
    except Timeout:
        pass
`,
    );
    expect(symbol(facts, "pkg/a.py#function:run")).toMatchObject({
      signature: "def run(self, model: Model, retries: int = 2, *rest) -> mod.Result",
      doc: "Run it once.",
    });
    expect(referencesOf(facts, ["accepts", "returns", "throws", "catches"])).toEqual([
      "function:run accepts Model",
      "function:run accepts int",
      "function:run returns mod.Result",
      "function:run throws ConfigError",
      "function:run catches KeyError",
      "function:run catches errors.Oops",
      "function:run catches Timeout",
    ]);
  });

  it("reads Go signatures, comment docs, annotated types, and errors returned", async () => {
    const facts = await extractFile(
      "server/a.go",
      "go",
      `package server

// Serve answers one request.
// It never blocks.
func (s *Server) Serve(r *http.Request, c Config) (Reply, error) {
	if c.Off {
		return Reply{}, &NotFound{}
	}
	return Reply{}, errors.New("plain")
}

// Config holds settings.
type Config struct {
	Off bool
}
`,
    );
    expect(symbol(facts, "server/a.go#method:Server.Serve")).toMatchObject({
      signature: "func (s *Server) Serve(r *http.Request, c Config) (Reply, error)",
      doc: "Serve answers one request. It never blocks.",
    });
    expect(symbol(facts, "server/a.go#class:Config")).toMatchObject({
      signature: "Config struct",
      doc: "Config holds settings.",
    });
    expect(referencesOf(facts, ["accepts", "returns", "throws"])).toEqual([
      "method:Server.Serve accepts http.Request",
      "method:Server.Serve accepts Config",
      "method:Server.Serve returns Reply",
      "method:Server.Serve returns error",
      // `errors.New` names no type.
      "method:Server.Serve throws NotFound",
    ]);
  });

  it("reads Rust signatures, /// docs past attributes, annotated types, Err values, and Err arms", async () => {
    const facts = await extractFile(
      "src/a.rs",
      "rust",
      `/// Builds one.
/// Quickly.
#[inline]
pub fn make(config: &Config, items: Vec<Item>) -> Result<Thing, MyError> {
    match load() {
        Err(MyError::Missing) => {}
        Err(other) => {}
        _ => {}
    }
    Err(MyError::Bad)
}
`,
    );
    expect(symbol(facts, "src/a.rs#function:make")).toMatchObject({
      signature: "pub fn make(config: &Config, items: Vec<Item>) -> Result<Thing, MyError>",
      doc: "Builds one. Quickly.",
    });
    expect(referencesOf(facts, ["accepts", "returns", "throws", "catches"])).toEqual([
      "function:make accepts Config",
      "function:make accepts Vec",
      "function:make accepts Item",
      "function:make returns Result",
      "function:make returns Thing",
      "function:make returns MyError",
      "function:make catches MyError",
      "function:make throws MyError",
    ]);
  });

  it("amends a symbol whose doc changed, though its text did not", async () => {
    const before = await extractFile("src/a.ts", "typescript", "/** Old. */\nfunction f() {}\n");
    const after = await extractFile("src/a.ts", "typescript", "/** New. */\nfunction f() {}\n");
    expect(symbol(after, "src/a.ts#function:f")?.hash).not.toBe(
      symbol(before, "src/a.ts#function:f")?.hash,
    );
  });

  it("clips a long signature to 200 characters and a long doc to 400", async () => {
    const parameters = Array.from({ length: 40 }, (_, index) => `p${index}: number`).join(", ");
    const facts = await extractFile(
      "src/a.ts",
      "typescript",
      `/** ${"word ".repeat(120)} */\nfunction wide(${parameters}) {}\n`,
    );
    const wide = symbol(facts, "src/a.ts#function:wide");
    expect(wide?.signature?.length).toBeLessThanOrEqual(200);
    expect(wide?.signature?.endsWith("…")).toBe(true);
    expect(wide?.doc?.length).toBeLessThanOrEqual(400);
    expect(wide?.doc?.endsWith("…")).toBe(true);
  });
});
