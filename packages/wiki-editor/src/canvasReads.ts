/**
 * What a board's visible cards ask its host for, by key: a card appears, its read joins the next
 * batch. Values stay on screen through a refresh until new ones replace them.
 */
export class BatchedReads<V> {
  #read: (keys: ReadonlyArray<string>) => Promise<ReadonlyArray<V>> = async () => [];
  readonly #batch: number;
  readonly #values = new Map<string, V>();
  readonly #fresh = new Set<string>();
  readonly #queued = new Set<string>();
  readonly #listeners = new Set<() => void>();
  #scheduled = false;
  #generation = 0;

  constructor(batch: number) {
    this.#batch = batch;
  }

  /** Where reads go from now on; what they find is the same, so nothing is read again. */
  readFrom(read: (keys: ReadonlyArray<string>) => Promise<ReadonlyArray<V>>) {
    this.#read = read;
  }

  readonly get = (key: string): V | undefined => this.#values.get(key);

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Asks for what isn't known at this revision. Everything asked for in one task is one batch. */
  want(keys: Iterable<string>) {
    for (const key of keys) if (!this.#fresh.has(key)) this.#queued.add(key);
    if (this.#queued.size === 0 || this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => this.#flush());
  }

  /** The source moved on: what is known stays shown, and is read again when next wanted. */
  invalidate() {
    this.#generation += 1;
    this.#fresh.clear();
  }

  #flush() {
    this.#scheduled = false;
    const keys = [...this.#queued];
    this.#queued.clear();
    for (const key of keys) this.#fresh.add(key);
    for (let start = 0; start < keys.length; start += this.#batch) {
      void this.#load(keys.slice(start, start + this.#batch));
    }
  }

  async #load(keys: ReadonlyArray<string>) {
    const generation = this.#generation;
    const values = await this.#read(keys).catch((): ReadonlyArray<V> => []);
    if (generation !== this.#generation) return;
    keys.forEach((key, position) => {
      const value = values[position];
      if (value === undefined) this.#fresh.delete(key);
      else this.#values.set(key, value);
    });
    for (const listener of this.#listeners) listener();
  }
}
