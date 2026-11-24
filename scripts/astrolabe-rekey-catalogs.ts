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

export type Catalog = Readonly<Record<string, string>>;

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
  readonly catalog: Record<string, string>;
  /** Current keys that took a translation. */
  readonly carried: ReadonlyArray<string>;
  /** Current keys whose rebranded translation fell back to English. */
  readonly english: ReadonlyArray<string>;
  /** New current keys no upstream entry rebrands to. */
  readonly unmatched: ReadonlyArray<string>;
  /** Current keys with several differing upstream translations and no way to tell them apart. */
  readonly ambiguous: ReadonlyArray<string>;
}

export const rebrandEnglish = (text: string, rules: ReadonlyArray<RebrandRule>): string =>
  rules.reduce((value, rule) => value.replaceAll(rule.from, rule.to), text);

const rebrandTranslation = (
  locale: string,
  upstreamText: string,
  translated: string,
  rebranded: string,
  rules: ReadonlyArray<RebrandRule>,
): { readonly value: string; readonly english: boolean } => {
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
    const rebranded = rebrandEnglish(text, rules);
    if (rebranded === text) continue;
    const keys = upstreamByRebrand.get(rebranded) ?? [];
    keys.push(key);
    upstreamByRebrand.set(rebranded, keys);
  }

  const newKeysByText = new Map<string, Array<string>>();
  for (const [key, text] of Object.entries(input.currentEn)) {
    if (key in input.upstreamEn) continue;
    const keys = newKeysByText.get(text) ?? [];
    keys.push(key);
    newKeysByText.set(text, keys);
  }

  const catalog: Record<string, string> = { ...input.currentLocale };
  const carried: Array<string> = [];
  const english: Array<string> = [];
  const unmatched: Array<string> = [];
  const ambiguous: Array<string> = [];

  for (const [key, text] of Object.entries(input.currentEn)) {
    if (key in input.upstreamEn) continue;
    // A translation already here was written by hand, never by generate.
    if (input.currentLocale[key] !== undefined && input.currentLocale[key] !== text) continue;
    let candidates = upstreamByRebrand.get(text) ?? [];
    if (candidates.length === 0) {
      unmatched.push(key);
      continue;
    }
    if (input.hashKey !== undefined && input.contexts !== undefined) {
      const { hashKey, contexts } = input;
      const exact = candidates.filter((candidate) => {
        const upstreamContext = contextOf(
          candidate,
          input.upstreamEn[candidate]!,
          hashKey,
          contexts,
        );
        return upstreamContext.found && hashKey(text, upstreamContext.context) === key;
      });
      if (exact.length > 0) candidates = exact;
    }
    const translations = new Set(candidates.map((candidate) => input.upstreamLocale[candidate]));
    let source = candidates[0]!;
    if (translations.size > 1) {
      // Same English, different `$context`: both catalogs list keys in source order, so the
      // n-th new key with this text pairs with the n-th upstream key it rebrands from.
      const siblings = newKeysByText.get(text) ?? [];
      if (siblings.length !== candidates.length) {
        ambiguous.push(key);
        continue;
      }
      source = candidates[siblings.indexOf(key)]!;
    }
    const upstreamText = input.upstreamEn[source]!;
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

const CatalogJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String), { space: 2 }),
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
          yield* Effect.log(`  ${key}: ${currentEn[key]}`);
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
