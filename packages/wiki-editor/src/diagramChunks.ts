/** A chunk of a diagram type's code, as CommonJS: `generate-wiki-editor.mts` writes them. */
export type DiagramChunk = (
  module: { exports: unknown },
  exports: unknown,
  require: (path: string) => unknown,
) => void;

/**
 * The phone's page is one HTML string with nowhere to fetch a chunk from, so each diagram type's
 * code arrives by injection: `loadDiagram` asks, and the app's script calls back with the type's
 * chunks, or null when it has none. Chunks hold state, so each runs once however often it comes.
 */
export function createDiagramLoader(
  ask: (diagram: string) => void,
  register: (definition: never) => void,
) {
  const factories = new Map<string, DiagramChunk>();
  const modules = new Map<string, { exports: unknown }>();
  const pending = new Map<string, Promise<boolean>>();
  const settle = new Map<string, (loaded: boolean) => void>();

  const requireChunk = (path: string): unknown => {
    const name = path.replace(/^\.\//, "");
    const loaded = modules.get(name);
    if (loaded !== undefined) return loaded.exports;
    const factory = factories.get(name);
    if (factory === undefined) throw new Error(`The diagram chunk ${name} never arrived.`);
    const module = { exports: {} };
    modules.set(name, module);
    factory(module, module.exports, requireChunk);
    return module.exports;
  };

  return {
    /** Loads a type and registers it. A failure can be retried. */
    load(diagram: string): Promise<boolean> {
      const loading = pending.get(diagram);
      if (loading !== undefined) return loading;
      const started = new Promise<boolean>((resolve, reject) => {
        settle.set(diagram, (loaded) =>
          loaded ? resolve(true) : reject(new Error(`No diagram type ${diagram}.`)),
        );
      });
      pending.set(diagram, started);
      ask(diagram);
      return started;
    },
    /** What the app's script calls: the type's entry, and the chunks it needs. */
    receive(diagram: string, entry: string | null, chunks: Record<string, DiagramChunk> | null) {
      const finish = settle.get(diagram);
      settle.delete(diagram);
      try {
        if (entry === null || chunks === null) throw new Error("No such type");
        for (const [name, factory] of Object.entries(chunks)) {
          if (!factories.has(name)) factories.set(name, factory);
        }
        const { default: definition } = requireChunk(entry) as { default: never };
        register(definition);
        finish?.(true);
      } catch {
        pending.delete(diagram);
        finish?.(false);
      }
    },
  };
}
