import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme defaults", () => {
  it("opens a fresh install in Mercurian, following the system appearance", async () => {
    vi.stubGlobal("window", { localStorage: createStorage() });

    const { readAppearanceModePreference, readThemePreference } = await import("./useTheme");

    const theme = readThemePreference();
    expect(theme).toBe("mercurian");
    expect(readAppearanceModePreference(theme)).toBe("system");
  });
});
