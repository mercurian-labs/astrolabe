/**
 * Keep: a board drawn in a thread, saved into a wiki. The tool call is the only record of it, so
 * this reads the call and lands a change request, never main. Code cards become links pinned to
 * what the remote has, or text when they can't be.
 *
 * @module CanvasKeep
 */
import {
  canvasData,
  canvasFile,
  keptCanvasSource,
  placeCanvas,
  type CanvasCodePin,
  type CanvasCodeReference,
  type CanvasCodeUnpinned,
} from "@mercurian/wiki";
import {
  CANVAS_SHOW_TOOL_NAME,
  CanvasShowInput,
  CanvasShowResult,
  type RepositoryIdentity,
  TurnItemId,
  WikiError,
  type WikiKeepCanvasInput,
  type WikiKeepCanvasResult,
} from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import { toolArguments, toolResultData } from "@t3tools/shared/toolOutput";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WikiService from "./WikiService.ts";

export class CanvasKeep extends Context.Service<
  CanvasKeep,
  {
    /** The author decides whose change request it joins; `threadId` is only where it was drawn. */
    readonly keep: (
      input: WikiKeepCanvasInput,
      author: WikiService.WikiAuthor,
    ) => Effect.Effect<WikiKeepCanvasResult, WikiError>;
  }
>()("t3/wiki/CanvasKeep") {}

const decodeInput = Schema.decodeUnknownOption(CanvasShowInput);
const decodeResult = Schema.decodeUnknownOption(CanvasShowResult);

const gone = (input: WikiKeepCanvasInput, cause?: unknown) =>
  new WikiError({
    reason: "not-found",
    message: "This board is no longer in its thread.",
    wikiId: input.wikiId,
    ...(cause === undefined ? {} : { cause }),
  });

type Unlinked = "no-remote" | "no-host" | "not-pushed" | "no-file";

interface CodeFacts {
  readonly identity: RepositoryIdentity | undefined;
  readonly remote: LinkedRemote | undefined;
  readonly root: string | undefined;
  /** What the card was read at, when the thread was in a repository. */
  readonly commit: string | null;
  readonly pushed: string | null;
}

interface LinkedRemote {
  readonly key: string;
  readonly name: string;
  readonly url: string;
  readonly provider: RepositoryIdentity["provider"];
  readonly webUrl: string | undefined;
}

/**
 * Where a link can reach the code. A fork's identity is the project it forked, but its commits are
 * on origin, and a link to the upstream would miss them.
 */
const linkedRemote = ({
  canonicalKey,
  locator,
  origin,
  provider,
  webUrl,
}: RepositoryIdentity): LinkedRemote =>
  origin?.remoteUrl === undefined
    ? { key: canonicalKey, name: locator.remoteName, url: locator.remoteUrl, provider, webUrl }
    : {
        key: origin.canonicalKey,
        name: "origin",
        url: origin.remoteUrl,
        provider: sourceControlDefinitions.recognizeRemote(origin.remoteUrl)?.kind,
        webUrl: undefined,
      };

const cards = (count: number) => (count === 1 ? "1 code card" : `${count} code cards`);

const UNLINKED_NOTES: Readonly<Record<Unlinked, (count: number) => string>> = {
  "no-remote": (count) => `${cards(count)} became text: this repository has no remote to link to.`,
  "no-host": (count) => `${cards(count)} became text: this host has no link to a file at a commit.`,
  "not-pushed": (count) => `${cards(count)} became text: no commit of theirs has been pushed.`,
  "no-file": (count) => `${cards(count)} became text: the file isn't in the nearest pushed commit.`,
};

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const wikis = yield* WikiService.WikiService;

  /** Where the thread's code stands, read once for all of a board's code cards. */
  const readFacts = Effect.fn("CanvasKeep.readFacts")(function* (
    input: WikiKeepCanvasInput,
    commit: string | null,
  ) {
    const shell = yield* orchestrator
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError((cause) => gone(input, cause)));
    if (shell === null) return yield* gone(input);
    const project = yield* projects
      .getById(shell.projectId)
      .pipe(Effect.orElseSucceed(Option.none));
    const identity = Option.isSome(project)
      ? yield* projects.readRepositoryIdentity(project.value)
      : null;
    const root = Option.isSome(project) ? project.value.workspaceRoot : undefined;
    const remote = identity === null ? undefined : linkedRemote(identity);
    const pushed =
      commit === null || root === undefined || remote === undefined
        ? null
        : yield* git
            .nearestPushedCommit({ cwd: root, commit, remoteName: remote.name })
            .pipe(Effect.orElseSucceed(() => null));
    return { identity: identity ?? undefined, remote, root, commit, pushed } satisfies CodeFacts;
  });

  const pinCode = Effect.fn("CanvasKeep.pinCode")(function* (
    code: CanvasCodeReference,
    { identity, remote, root, commit, pushed }: CodeFacts,
  ): Effect.fn.Return<CanvasCodePin | Unlinked> {
    if (!identity || !remote || root === undefined) return "no-remote";
    const host = remote.provider && sourceControlDefinitions.find(remote.provider);
    const [hostName, ...path] = remote.key.split("/");
    if (host === undefined || !hostName) return "no-host";
    if (commit === null || pushed === null) return "not-pushed";
    const text = yield* git
      .readFileAtCommit({ cwd: root, commit: pushed, path: code.path })
      .pipe(Effect.orElseSucceed(() => null));
    if (text === null) return "no-file";
    const lineCount = text.split("\n").length;
    const lines = code.lines !== undefined && code.lines[1] <= lineCount ? code.lines : undefined;
    const url = host.fileUrl({
      host: hostName,
      repository: path.join("/"),
      sha: pushed,
      remoteUrl: remote.url,
      ...(remote.webUrl === undefined ? {} : { webUrl: remote.webUrl }),
      path: code.path,
      lines,
    });
    if (url === null) return "no-host";
    return {
      url,
      commit: pushed,
      repository: identity.canonicalKey,
      ...(lines === undefined ? {} : { lines }),
    };
  });

  const keep: CanvasKeep["Service"]["keep"] = Effect.fn("CanvasKeep.keep")(
    function* (input, author) {
      const file = canvasFile(input.name);
      if (file === null) {
        return yield* new WikiError({
          reason: "invalid",
          message: `A wiki can't hold a canvas at ${input.name}.`,
          wikiId: input.wikiId,
        });
      }
      const read = (itemId: TurnItemId) =>
        orchestrator
          .getTurnItem({ threadId: input.threadId, itemId })
          .pipe(Effect.mapError((cause) => gone(input, cause)));
      const asked = yield* read(input.itemId);
      const call =
        asked?.type === "dynamic_tool" &&
        asked.status === "completed" &&
        resolveT3McpToolId(asked.toolName) === CANVAS_SHOW_TOOL_NAME
          ? asked
          : undefined;
      // A call that recorded its board keeps that board, laid out as it was shown.
      const shown =
        call === undefined
          ? undefined
          : Option.getOrUndefined(decodeResult(toolResultData(call.output) ?? {}));
      const item =
        shown?.canvasItemId === undefined
          ? asked
          : yield* read(TurnItemId.make(shown.canvasItemId));
      const board =
        item?.type === "canvas"
          ? { title: item.title ?? "Canvas", data: canvasData(item.document), code: item.code }
          : call === undefined
            ? undefined
            : Option.match(decodeInput(toolArguments(call.input)), {
                onNone: () => undefined,
                onSome: (drawing) => ({
                  title: drawing.title,
                  data: placeCanvas(drawing),
                  code: shown?.code,
                }),
              });
      if (board === undefined) return yield* gone(input);
      const { data } = board;
      const codes = data.nodes.flatMap((node) =>
        node.type === "link" && node.astrolabe?.code !== undefined ? [node.astrolabe.code] : [],
      );

      const pins = new Map<string, CanvasCodePin | Unlinked>();
      const keyOf = ({ path, lines }: Pick<CanvasCodeReference, "path" | "lines">) =>
        JSON.stringify([path, lines ?? null]);
      const commit = board.code?.commit ?? null;
      const facts = codes.length === 0 ? null : yield* readFacts(input, commit);
      if (facts !== null) {
        for (const each of codes) {
          if (!pins.has(keyOf(each))) pins.set(keyOf(each), yield* pinCode(each, facts));
        }
      }
      const answers = codes.flatMap((each) => pins.get(keyOf(each)) ?? []);
      const source = keptCanvasSource(
        data,
        (each): CanvasCodePin | CanvasCodeUnpinned => {
          const pinned = pins.get(keyOf(each));
          return pinned === undefined || typeof pinned === "string" ? { commit } : pinned;
        },
        `${input.itemId}:${input.name}`,
      );

      const title = `Keep ${board.title}`;
      const landed = yield* wikis.transform(
        {
          wikiId: input.wikiId,
          title,
          message: input.comment ?? title,
          transform: { kind: "canvas-create", file, source },
        },
        author,
      );

      const linked = answers.filter((answer) => typeof answer !== "string");
      const behind = linked.filter((pin) => pin.commit !== commit);
      const unlinked = (reason: Unlinked) => answers.filter((answer) => answer === reason).length;
      const notes = [
        ...(behind.length === 0
          ? []
          : [
              `${cards(behind.length)} ${behind.length === 1 ? "points" : "point"} at unpushed code, so ${behind.length === 1 ? "it links" : "they link"} to the nearest pushed commit, ${behind[0]?.commit.slice(0, 12)}. The code there may differ.`,
            ]),
        ...(["no-remote", "no-host", "not-pushed", "no-file"] as const).flatMap((reason) => {
          const count = unlinked(reason);
          return count === 0 ? [] : [UNLINKED_NOTES[reason](count)];
        }),
      ];
      return { changeRequest: landed.changeRequest, file, notes };
    },
  );

  return { keep } satisfies CanvasKeep["Service"];
});

export const layer = Layer.effect(CanvasKeep, make);
