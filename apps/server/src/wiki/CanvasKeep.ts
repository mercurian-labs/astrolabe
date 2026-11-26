/**
 * Keep: a board drawn in a thread, read from its tool call, saved as a file in a project folder.
 * Each code card links to what its own folder's remote has, or becomes text.
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
  type ProjectRootCheckout,
  projectRootId,
  type ProjectRootsError,
  type ProjectRootWriteTargetError,
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
import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import * as WikiService from "./WikiService.ts";

export class CanvasKeep extends Context.Service<
  CanvasKeep,
  {
    /**
     * An author with a thread writes in that thread's checkout; a person (no thread) writes where
     * `threadId`, the thread it was drawn in, has the folder checked out.
     */
    readonly keep: (
      input: WikiKeepCanvasInput,
      author: WikiService.WikiAuthor,
    ) => Effect.Effect<WikiKeepCanvasResult, WikiError>;
  }
>()("t3/wiki/CanvasKeep") {}

const decodeInput = Schema.decodeUnknownOption(CanvasShowInput);
const decodeResult = Schema.decodeUnknownOption(CanvasShowResult);

const gone = (cause?: unknown) =>
  new WikiError({
    reason: "not-found",
    message: "This board is no longer in its thread.",
    ...(cause === undefined ? {} : { cause }),
  });

const refused = (error: ProjectRootsError | ProjectRootWriteTargetError) =>
  new WikiError({
    reason: "invalid",
    message:
      error._tag === "ProjectRootWriteTargetError" && error.candidates.length > 0
        ? `${error.message} Name one as repository: ${error.candidates.join(", ")}.`
        : error.message,
  });

type Unlinked = "no-remote" | "no-host" | "not-pushed" | "no-file";

/** Where one folder's code stands, read once for all of a board's code cards in it. */
interface CodeFacts {
  readonly identity: RepositoryIdentity | undefined;
  readonly remote: LinkedRemote | undefined;
  /** The folder's own checkout, which holds every commit its worktrees made. */
  readonly root: string;
  /** What the card was read at, when the folder was in a repository. */
  readonly commit: string | null;
  readonly pushed: string | null;
}

/** A code card's file, once its folder is known. */
interface CodeCard {
  readonly root: ProjectRootCheckout;
  readonly path: string;
  readonly lines: CanvasCodeReference["lines"];
  readonly commit: string | null;
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

/** A thread board's code card as an address its project's roots resolve. */
const addressOf = (code: CanvasCodeReference) =>
  code.root === undefined ? code.path : `${code.root}:${code.path}`;

const countCards = (count: number) => (count === 1 ? "1 code card" : `${count} code cards`);

const UNLINKED_NOTES: Readonly<Record<Unlinked, (count: number) => string>> = {
  "no-remote": (count) =>
    `${countCards(count)} became text: this repository has no remote to link to.`,
  "no-host": (count) =>
    `${countCards(count)} became text: this host has no link to a file at a commit.`,
  "not-pushed": (count) => `${countCards(count)} became text: no commit of theirs has been pushed.`,
  "no-file": (count) =>
    `${countCards(count)} became text: the file isn't in the nearest pushed commit.`,
};

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const wikis = yield* WikiService.WikiService;
  const projectRoots = yield* ProjectRoots.ProjectRoots;

  const shellOf = (threadId: WikiKeepCanvasInput["threadId"]) =>
    orchestrator.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));

  /** A Git checkout on the branch its repository's pull requests merge into. */
  const onDefaultBranch = Effect.fn("CanvasKeep.onDefaultBranch")(function* (folder: string) {
    const head = yield* git
      .execute({
        operation: "CanvasKeep.headBranch",
        cwd: folder,
        args: ["symbolic-ref", "-q", "--short", "HEAD"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.orElseSucceed(() => ""),
      );
    if (head === "") return false;
    const remote = (yield* projectRoots.host(folder))?.remote ?? "origin";
    const named = yield* git
      .resolveDefaultBranchName(folder, remote)
      .pipe(Effect.orElseSucceed(() => null));
    return named === null || named === head;
  });

  /**
   * The folder it goes in, as `ProjectRoots.writeTarget` picks it, and where it lands there: on
   * disk in the author's checkout, or, for a person in a hosted repository's main checkout on its
   * default branch, in a change request.
   */
  const placeOf = Effect.fn("CanvasKeep.placeOf")(function* (
    input: WikiKeepCanvasInput,
    author: WikiService.WikiAuthor,
  ) {
    const own = author.threadId === null ? null : yield* shellOf(author.threadId);
    if (author.threadId !== null && own === null) return yield* gone();
    const worktreePath = own?.projectId === input.projectId ? own.worktreePath : null;
    const { root, path } = yield* projectRoots
      .writeTarget({
        projectId: input.projectId,
        worktreePath,
        address: input.name,
        ...(input.repository === undefined ? {} : { repository: input.repository }),
      })
      .pipe(Effect.mapError(refused));
    // A folder without Git is only ever its own folder: a task's copy of it links back there.
    if (root.state !== "git") return { root, path, folder: root.path, review: false };
    if (own !== null) return { root, path, folder: root.checkout ?? root.path, review: false };

    const drawn = yield* shellOf(input.threadId);
    const checkout =
      drawn === null || drawn.projectId !== input.projectId || drawn.worktreePath === null
        ? null
        : ((yield* projectRoots
            .forThread({ projectId: input.projectId, worktreePath: drawn.worktreePath })
            .pipe(Effect.orElseSucceed((): ReadonlyArray<ProjectRootCheckout> => []))).find(
            (each) => each.key === root.key,
          )?.checkout ?? null);
    if (checkout !== null && checkout !== root.path) {
      return { root, path, folder: checkout, review: false };
    }
    const review = root.hostBacked && (yield* onDefaultBranch(root.path));
    return { root, path, folder: root.path, review };
  });

  /** Each code card's folder, in the project of the thread that drew it. */
  const readCards = Effect.fn("CanvasKeep.readCards")(function* (
    threadId: WikiKeepCanvasInput["threadId"],
    codes: ReadonlyArray<CanvasCodeReference>,
    commitOf: (root: ProjectRootCheckout) => string | null,
  ) {
    const shell = yield* shellOf(threadId);
    if (shell === null) return yield* gone();
    const addresses = [...new Set(codes.map(addressOf))];
    const resolved = yield* projectRoots
      .resolveAll({ projectId: shell.projectId, worktreePath: shell.worktreePath, addresses })
      .pipe(Effect.option);
    const cards = new Map<string, Omit<CodeCard, "lines">>();
    if (Option.isSome(resolved)) {
      resolved.value.paths.forEach(({ root, path }, index) =>
        cards.set(addresses[index]!, { root, path, commit: commitOf(root) }),
      );
    }
    return { projectId: shell.projectId, cards };
  });

  /** Where one folder's code stands at the commit its cards were read at. */
  const readFacts = Effect.fn("CanvasKeep.readFacts")(function* (
    projectId: WikiKeepCanvasInput["projectId"],
    { root, commit }: Pick<CodeCard, "root" | "commit">,
  ) {
    const project =
      root.kind === "workspace"
        ? yield* projects.getById(projectId).pipe(Effect.orElseSucceed(Option.none))
        : Option.none();
    const identity = yield* projects.readRepositoryIdentity(
      Option.isSome(project) ? project.value : { workspaceRoot: root.path },
    );
    const remote = identity === null ? undefined : linkedRemote(identity);
    const pushed =
      commit === null || remote === undefined
        ? null
        : yield* git
            .nearestPushedCommit({ cwd: root.path, commit, remoteName: remote.name })
            .pipe(Effect.orElseSucceed(() => null));
    return {
      identity: identity ?? undefined,
      remote,
      root: root.path,
      commit,
      pushed,
    } satisfies CodeFacts;
  });

  const pinCode = Effect.fn("CanvasKeep.pinCode")(function* (
    code: Pick<CodeCard, "path" | "lines">,
    { identity, remote, root, commit, pushed }: CodeFacts,
  ): Effect.fn.Return<CanvasCodePin | Unlinked> {
    if (!identity || !remote) return "no-remote";
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
      path: code.path,
      ...(lines === undefined ? {} : { lines }),
    };
  });

  const keep: CanvasKeep["Service"]["keep"] = Effect.fn("CanvasKeep.keep")(
    function* (input, author) {
      const place = yield* placeOf(input, author);
      const wikiId = projectRootId(input.projectId, place.root.key);
      const file = canvasFile(place.path ?? input.name);
      if (file === null) {
        return yield* new WikiError({
          reason: "invalid",
          message: `A folder can't hold a canvas at ${input.name}.`,
          wikiId,
        });
      }
      const read = (itemId: TurnItemId) =>
        orchestrator
          .getTurnItem({ threadId: input.threadId, itemId })
          .pipe(Effect.mapError((cause) => gone(cause)));
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
      if (board === undefined) return yield* gone();
      const { data } = board;
      const codes = data.nodes.flatMap((node) =>
        node.type === "link" && node.astrolabe?.code !== undefined ? [node.astrolabe.code] : [],
      );

      // Boards from before `codes` name only the project folder's commit.
      const commitOf = (root: ProjectRootCheckout) =>
        shown?.codes?.[root.key]?.commit ??
        (root.kind === "workspace" ? board.code?.commit : undefined) ??
        null;
      const { projectId, cards } =
        codes.length === 0
          ? { projectId: input.projectId, cards: new Map<string, Omit<CodeCard, "lines">>() }
          : yield* readCards(input.threadId, codes, commitOf);
      const facts = new Map<string, CodeFacts>();
      const pins = new Map<string, CanvasCodePin | Unlinked>();
      const keyOf = (card: CodeCard) =>
        JSON.stringify([card.root.key, card.commit, card.path, card.lines ?? null]);
      const cardOf = (code: CanvasCodeReference): CodeCard | undefined => {
        const found = cards.get(addressOf(code));
        return found === undefined ? undefined : { ...found, lines: code.lines };
      };
      for (const code of codes) {
        const card = cardOf(code);
        if (card === undefined || pins.has(keyOf(card))) continue;
        const factsKey = `${card.root.key} ${card.commit ?? ""}`;
        let known = facts.get(factsKey);
        if (known === undefined) {
          known = yield* readFacts(projectId, card);
          facts.set(factsKey, known);
        }
        pins.set(keyOf(card), yield* pinCode(card, known));
      }
      const answers = codes.map((code) => {
        const card = cardOf(code);
        return {
          readAt: card?.commit ?? null,
          pin: card === undefined ? ("no-remote" as const) : pins.get(keyOf(card))!,
        };
      });
      const source = keptCanvasSource(
        data,
        (each): CanvasCodePin | CanvasCodeUnpinned => {
          const card = cardOf(each);
          const pinned = card === undefined ? undefined : pins.get(keyOf(card));
          return pinned === undefined || typeof pinned === "string"
            ? { commit: card?.commit ?? null }
            : pinned;
        },
        `${input.itemId}:${input.name}`,
      );

      const title = `Keep ${board.title}`;
      const transform = {
        wikiId,
        title,
        message: input.comment ?? title,
        transform: { kind: "canvas-create" as const, file, source },
      };
      const changeRequest = place.review
        ? (yield* wikis.transform(transform, author)).changeRequest
        : null;
      if (!place.review) {
        yield* wikis.transformCheckout({ ...transform, checkout: place.folder }, author);
      }

      const behind = answers.flatMap(({ pin, readAt }) =>
        typeof pin !== "string" && pin.commit !== readAt ? [pin] : [],
      );
      const unlinked = (reason: Unlinked) => answers.filter(({ pin }) => pin === reason).length;
      const notes = [
        ...(behind.length === 0
          ? []
          : [
              `${countCards(behind.length)} ${behind.length === 1 ? "points" : "point"} at unpushed code, so ${behind.length === 1 ? "it links" : "they link"} to the nearest pushed commit, ${behind[0]?.commit.slice(0, 12)}. The code there may differ.`,
            ]),
        ...(["no-remote", "no-host", "not-pushed", "no-file"] as const).flatMap((reason) => {
          const count = unlinked(reason);
          return count === 0 ? [] : [UNLINKED_NOTES[reason](count)];
        }),
      ];
      return {
        rootKey: place.root.key,
        file,
        changeRequest,
        ...(place.review ? {} : { checkout: place.folder }),
        notes,
      };
    },
  );

  return { keep } satisfies CanvasKeep["Service"];
});

export const layer = Layer.effect(CanvasKeep, make);
