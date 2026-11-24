#!/usr/bin/env node
/**
 * GT keys catalogs by a hash of the English, so rebranding a source string drops its translations.
 * Run after `vp run i18n:generate`: `node scripts/astrolabe-rekey-catalogs.ts --upstream <ref>`.
 */ import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** A catalog value: a string, or the array or object a `<T>` entry compiles to. */
export type Entry = unknown;
export type Catalog = Readonly<Record<string, Entry>>;

export interface RebrandRule {
  readonly from: string;
  readonly to: string;
  /**
   * `replace` rewrites the name inside translations too. `english` leaves the entry in English,
   * unless the whole translation is the name and `glossary` gives the locale's word for it.
   */
  readonly translation: "replace" | "english";
  readonly glossary?: Readonly<Record<string, string>>;
}

export const ASTROLABE_REBRAND_RULES: ReadonlyArray<RebrandRule> = [
  { from: "T3 Code", to: "Astrolabe", translation: "replace" },
  {
    from: "T3 Connect",
    to: "Remote access",
    translation: "english",
    glossary: {
      de: "Fernzugriff",
      es: "Acceso remoto",
      fr: "Accès à distance",
      ja: "リモートアクセス",
      ko: "원격 액세스",
      "pt-BR": "Acesso remoto",
      ru: "Удалённый доступ",
      sv: "Fjärråtkomst",
      zh: "远程访问",
    },
  },
];

/** A source string's key, from its English and `$context`, as the GT CLI computes it. */
export type KeyHasher = (text: string, context: string | undefined) => string;

export interface RekeyInput {
  readonly locale: string;
  readonly upstreamEn: Catalog;
  readonly upstreamLocale: Catalog;
  readonly currentEn: Catalog;
  readonly currentLocale: Catalog;
  readonly rules?: ReadonlyArray<RebrandRule>;
  /** With both, a candidate is kept only when its `$context` also produces the current key. */
  readonly hashKey?: KeyHasher;
  readonly contexts?: ReadonlyArray<string>;
}

export interface RekeyResult {
  readonly catalog: Record<string, Entry>;
  /** Current keys that took a translation. */
  readonly carried: ReadonlyArray<string>;
  /** Current keys whose rebranded translation fell back to English. */
  readonly english: ReadonlyArray<string>;
  /** New current keys no upstream entry rebrands to. */
  readonly unmatched: ReadonlyArray<string>;
  /** Current keys with several differing upstream translations and no way to tell them apart. */
  readonly ambiguous: ReadonlyArray<string>;
}

const mapStrings = (entry: Entry, f: (text: string) => string): Entry =>
  typeof entry === "string"
    ? f(entry)
    : Array.isArray(entry)
      ? entry.map((item) => mapStrings(item, f))
      : entry !== null && typeof entry === "object"
        ? Object.fromEntries(
            Object.entries(entry).map(([key, value]) => [key, mapStrings(value, f)]),
          )
        : entry;

const textOf = (entry: Entry): string => JSON.stringify(entry);

export const rebrandEnglish = <E extends Entry>(text: E, rules: ReadonlyArray<RebrandRule>): E =>
  mapStrings(text, (value) =>
    rules.reduce((current, rule) => current.replaceAll(rule.from, rule.to), value),
  ) as E;

const rebrandTranslation = (
  locale: string,
  upstreamText: Entry,
  translated: Entry,
  rebranded: Entry,
  rules: ReadonlyArray<RebrandRule>,
): { readonly value: Entry; readonly english: boolean } => {
  if (typeof upstreamText !== "string" || typeof translated !== "string") {
    // A `<T>` entry: carry it with "replace" names swapped, or fall back to English.
    if (textOf(translated) === textOf(upstreamText)) return { value: rebranded, english: false };
    const upstream = textOf(upstreamText);
    const translatedText = textOf(translated);
    for (const rule of rules) {
      if (!upstream.includes(rule.from)) continue;
      if (rule.translation !== "replace" || !translatedText.includes(rule.from)) {
        return { value: rebranded, english: true };
      }
    }
    return {
      value: mapStrings(translated, (value) =>
        rules.reduce(
          (current, rule) =>
            rule.translation === "replace" ? current.replaceAll(rule.from, rule.to) : current,
          value,
        ),
      ),
      english: false,
    };
  }
  for (const rule of rules) {
    const word = rule.glossary?.[locale];
    if (
      word !== undefined &&
      upstreamText.trim() === rule.from &&
      translated.trim() === rule.from
    ) {
      return { value: word, english: false };
    }
  }
  if (translated === upstreamText) return { value: rebranded, english: false };
  let value = translated;
  for (const rule of rules) {
    if (!upstreamText.includes(rule.from)) continue;
    if (!value.includes(rule.from)) return { value: rebranded, english: true };
    if (rule.translation === "replace") {
      value = value.replaceAll(rule.from, rule.to);
      continue;
    }
    return { value: rebranded, english: true };
  }
  return { value, english: false };
};

const contextOf = (
  key: string,
  text: string,
  hashKey: KeyHasher,
  contexts: ReadonlyArray<string>,
): { readonly found: false } | { readonly found: true; readonly context: string | undefined } => {
  if (hashKey(text, undefined) === key) return { found: true, context: undefined };
  const context = contexts.find((candidate) => hashKey(text, candidate) === key);
  return context === undefined ? { found: false } : { found: true, context };
};

export const rekeyCatalog = (input: RekeyInput): RekeyResult => {
  const rules = input.rules ?? ASTROLABE_REBRAND_RULES;
  const upstreamByRebrand = new Map<string, Array<string>>();
  for (const [key, text] of Object.entries(input.upstreamEn)) {
    const rebranded = textOf(rebrandEnglish(text, rules));
    if (rebranded === textOf(text)) continue;
    const keys = upstreamByRebrand.get(rebranded) ?? [];
    keys.push(key);
    upstreamByRebrand.set(rebranded, keys);
  }

  const newKeysByText = new Map<string, Array<string>>();
  for (const [key, text] of Object.entries(input.currentEn)) {
    if (key in input.upstreamEn) continue;
    const keys = newKeysByText.get(textOf(text)) ?? [];
    keys.push(key);
    newKeysByText.set(textOf(text), keys);
  }

  const catalog: Record<string, Entry> = { ...input.currentLocale };
  const carried: Array<string> = [];
  const english: Array<string> = [];
  const unmatched: Array<string> = [];
  const ambiguous: Array<string> = [];

  for (const [key, text] of Object.entries(input.currentEn)) {
    if (key in input.upstreamEn) continue;
    // A translation already here was written by hand, never by generate.
    if (
      input.currentLocale[key] !== undefined &&
      textOf(input.currentLocale[key]) !== textOf(text)
    ) {
      continue;
    }
    let candidates = upstreamByRebrand.get(textOf(text)) ?? [];
    if (candidates.length === 0) {
      unmatched.push(key);
      continue;
    }
    if (input.hashKey !== undefined && input.contexts !== undefined) {
      const { hashKey, contexts } = input;
      const exact = candidates.filter((candidate) => {
        const upstreamEntry = input.upstreamEn[candidate];
        if (typeof upstreamEntry !== "string" || typeof text !== "string") return false;
        const upstreamContext = contextOf(candidate, upstreamEntry, hashKey, contexts);
        return upstreamContext.found && hashKey(text, upstreamContext.context) === key;
      });
      if (exact.length > 0) candidates = exact;
    }
    const translations = new Set(
      candidates.map((candidate) => textOf(input.upstreamLocale[candidate])),
    );
    let source = candidates[0]!;
    if (translations.size > 1) {
      // Same English, different `$context`: both catalogs list keys in source order, so the
      // n-th new key with this text pairs with the n-th upstream key it rebrands from.
      const siblings = newKeysByText.get(textOf(text)) ?? [];
      if (siblings.length !== candidates.length) {
        ambiguous.push(key);
        continue;
      }
      source = candidates[siblings.indexOf(key)]!;
    }
    const upstreamText = input.upstreamEn[source];
    const translated = input.upstreamLocale[source];
    if (translated === undefined) {
      unmatched.push(key);
      continue;
    }
    const result = rebrandTranslation(input.locale, upstreamText, translated, text, rules);
    catalog[key] = result.value;
    carried.push(key);
    if (result.english) english.push(key);
  }

  return { catalog, carried, english, unmatched, ambiguous };
};

const APPS = ["web", "mobile", "desktop"] as const;
type App = (typeof APPS)[number];

const CatalogJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown), { space: 2 }),
);

export const rekeyCatalogs = Effect.fn("rekeyCatalogs")(function* (
  upstream: string,
  apps: ReadonlyArray<App>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const gitShow = (file: string) =>
    spawner
      .string(ChildProcess.make("git", ["show", `${upstream}:${file}`], { cwd: repoRoot }))
      .pipe(
        Effect.flatMap(decodeCatalog),
        Effect.orElseSucceed(() => undefined),
      );

  for (const app of apps) {
    const dir = path.join("apps", app, "src", "i18n", "translations");
    const enFile = path.join(dir, "en.json");
    const upstreamEn = yield* gitShow(enFile);
    if (upstreamEn === undefined || !(yield* fs.exists(path.join(repoRoot, enFile)))) continue;
    const currentEn = yield* decodeCatalog(yield* fs.readFileString(path.join(repoRoot, enFile)));
    for (const file of (yield* fs.readDirectory(path.join(repoRoot, dir))).toSorted()) {
      if (!file.endsWith(".json") || file === "en.json") continue;
      const locale = file.slice(0, -".json".length);
      const localeFile = path.join(repoRoot, dir, file);
      const result = rekeyCatalog({
        locale,
        upstreamEn,
        upstreamLocale: (yield* gitShow(path.join(dir, file))) ?? {},
        currentEn,
        currentLocale: yield* decodeCatalog(yield* fs.readFileString(localeFile)),
      });
      yield* fs.writeFileString(localeFile, `${yield* encodeCatalog(result.catalog)}\n`);
      yield* Effect.log(
        `${app}/${locale}: carried ${result.carried.length} (${result.english.length} kept English), unmatched ${result.unmatched.length}, ambiguous ${result.ambiguous.length}`,
      );
      if (locale === "de") {
        for (const key of [...result.unmatched, ...result.ambiguous]) {
          yield* Effect.log(`  ${key}: ${textOf(currentEn[key])}`);
        }
      }
    }
  }
});

export const rekeyCatalogsCommand = Command.make(
  "astrolabe-rekey-catalogs",
  {
    upstream: Flag.String("upstream").pipe(
      Flag.withDescription("The upstream ref whose catalogs hold the translations to carry."),
    ),
    app: Flag.Literals("app", APPS).pipe(
      Flag.withDescription("Only this app's catalogs."),
      Flag.optional,
    ),
  },
  ({ upstream, app }) => rekeyCatalogs(upstream, app._tag === "Some" ? [app.value] : APPS),
).pipe(Command.withDescription("Carry upstream translations onto Astrolabe's rebranded keys."));

if (import.meta.main) {
  Command.run(rekeyCatalogsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
