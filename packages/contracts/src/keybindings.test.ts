import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import {
  KeybindingRule,
  ResolvedKeybindingsConfig,
  ResolvedKeybindingTriggers,
} from "./keybindings.ts";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

const shortcut = {
  key: "p",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: true,
};

it.effect("drops resolved rules with commands this build does not know", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      { command: "terminal.toggle", shortcut },
      { command: "someFuture.toggle", shortcut },
      { command: "filePicker.toggle", shortcut },
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle", "filePicker.toggle"],
    );
  }),
);

it.effect("drops malformed resolved rule entries", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      "garbage",
      { command: "terminal.toggle", shortcut },
      null,
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle"],
    );
  }),
);

// Astrolabe
it.effect("parses removal rules and rejects removals of unknown commands", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(KeybindingRule, { key: "menu t ]", command: "-chatTab.next" });
    assert.strictEqual(parsed.command, "-chatTab.next");
    const unknown = yield* Effect.exit(decode(KeybindingRule, { key: "mod+x", command: "-nope" }));
    assert.strictEqual(unknown._tag, "Failure");
  }),
);

it.effect("drops triggers whose command this build does not know", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingTriggers, {
      triggers: [
        { kind: "menu", command: "section.wikis", sequence: ["g", "w"] },
        { kind: "menu", command: "future.command", sequence: ["x"] },
        { kind: "chord", command: "section.wikis", keys: ["x"] },
        { kind: "alias", command: "tab.close", name: "quit", shortest: 1 },
      ],
      unboundCommands: ["usage.open", "future.command"],
    });
    assert.deepEqual(parsed, {
      triggers: [
        { kind: "menu", command: "section.wikis", sequence: ["g", "w"] },
        { kind: "alias", command: "tab.close", name: "quit", shortest: 1 },
      ],
      unboundCommands: ["usage.open"],
    });
  }),
);
