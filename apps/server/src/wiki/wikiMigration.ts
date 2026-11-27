/**
 * Moves registered wikis into projects once. The registry is set aside last, so a run that fails
 * partway runs again whole at the next start; every step before it is safe to repeat.
 */
import {
  CommandId,
  IsoDateTime,
  PROJECT_TRACKED_FOLDERS_MAX,
  ProjectId,
  projectRootId,
  type RootKey,
  TrimmedNonEmptyString,
  WikiMapBackground,
} from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Cause from "effect/Cause";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ChangeGroupService from "../changeGroups/ChangeGroupService.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import * as WikiService from "./WikiService.ts";
import type { WikiMigration } from "./wikiStorage.ts";

/** Where registered wikis were kept, and where the file goes once they are project roots. */
const WIKI_REGISTRY_FILE = "wikis.json";
const RETIRED_WIKI_REGISTRY_FILE = "wikis.json.pre-projects";

/** A registered wiki, as much of it as the move into projects reads. */
const RegisteredWiki = Schema.Struct({
  wikiId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  root: TrimmedNonEmptyString,
  projectIds: Schema.Array(ProjectId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  mirror: Schema.NullOr(Schema.Struct({ url: TrimmedNonEmptyString })),
  host: Schema.NullOr(Schema.Struct({ projectId: ProjectId })).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  mapBackgrounds: Schema.Array(WikiMapBackground).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  createdAt: IsoDateTime,
});
type RegisteredWiki = typeof RegisteredWiki.Type;

const WikiRegistryJson = fromJsonStringPretty(
  Schema.Struct({ version: Schema.Literal(1), wikis: Schema.Array(RegisteredWiki) }),
);

const decodeRegistry = Schema.decodeEffect(WikiRegistryJson);

const hostOf = (url: string) => {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

/** `current`, then each of `added` whose name it lacks, so the first stays the default. */
const unionBackgrounds = (
  current: ReadonlyArray<WikiMapBackground>,
  added: ReadonlyArray<WikiMapBackground>,
): ReadonlyArray<WikiMapBackground> => {
  const names = new Set(current.map(({ name }) => name.toLowerCase()));
  const union = [...current];
  for (const background of added) {
    if (names.has(background.name.toLowerCase())) continue;
    names.add(background.name.toLowerCase());
    union.push(background);
  }
  return union;
};

export const migrateWikis = Effect.fn("WikiMigration.run")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const projects = yield* ProjectService.ProjectService;
  const projectRoots = yield* ProjectRoots.ProjectRoots;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const wikis = yield* WikiService.WikiService;
  const changeGroups = yield* ChangeGroupService.ChangeGroupService;

  const registryPath = path.join(config.stateDir, WIKI_REGISTRY_FILE);
  if (!(yield* fileSystem.exists(registryPath))) return;
  const registry = yield* fileSystem
    .readFileString(registryPath)
    .pipe(Effect.flatMap(decodeRegistry));

  const real = (folder: string) =>
    fileSystem.realPath(folder).pipe(Effect.orElseSucceed(() => path.resolve(folder)));
  const commandId = Effect.map(random.uuidV4(), (uuid) => CommandId.make(`wiki-migration:${uuid}`));

  /** The key of the project's root at `folder`, when the project is there and has one. */
  const rootKeyAt = Effect.fnUntraced(function* (projectId: ProjectId, folder: string) {
    if (Option.isNone(yield* projects.getById(projectId))) return undefined;
    const roots = yield* projectRoots
      .list(projectId)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<{ key: RootKey; path: string }> => []));
    for (const root of roots) {
      if ((yield* real(root.path)) === folder) return root.key;
    }
    return undefined;
  });

  /** Adds the wiki's folder to the project, unless the project already covers it. */
  const track = Effect.fnUntraced(function* (
    wiki: RegisteredWiki,
    folder: string,
    projectId: ProjectId,
  ) {
    const found = yield* projects.getById(projectId);
    if (Option.isNone(found)) {
      return yield* Effect.logWarning("A wiki was linked to a project that is gone", {
        wiki: wiki.name,
        projectId,
      });
    }
    const project = found.value;
    if (isWithinRoot(path, folder, yield* real(project.workspaceRoot))) return;
    const tracked = project.trackedFolders ?? [];
    for (const entry of tracked) {
      if ((yield* real(entry.path)) === folder) return;
    }
    if (
      tracked.filter((entry) => entry.discovered !== true).length >= PROJECT_TRACKED_FOLDERS_MAX
    ) {
      return yield* Effect.logWarning(
        `A project tracks at most ${PROJECT_TRACKED_FOLDERS_MAX} folders, so a wiki's folder was not added to it`,
        { wiki: wiki.name, folder: wiki.root, projectId },
      );
    }
    yield* projects
      .update({
        commandId: yield* commandId,
        projectId,
        trackFolders: [{ path: wiki.root, name: wiki.name.slice(0, 128).trim() }],
      })
      .pipe(
        Effect.catchTags({
          ProjectInvalidError: (error) =>
            Effect.logWarning("A wiki's folder could not be added to its project", {
              wiki: wiki.name,
              projectId,
              detail: error.detail,
            }),
          ProjectNotFoundError: () => Effect.void,
        }),
      );
  });

  /** The project root the wiki becomes: a linked project's, its host's project's, or its own. */
  const place = Effect.fnUntraced(function* (wiki: RegisteredWiki) {
    const folder = yield* real(wiki.root);
    for (const projectId of wiki.projectIds) yield* track(wiki, folder, projectId);
    const candidates = [...wiki.projectIds, ...(wiki.host === null ? [] : [wiki.host.projectId])];
    for (const projectId of candidates) {
      const rootKey = yield* rootKeyAt(projectId, folder);
      if (rootKey !== undefined) return { projectId, rootKey };
    }
    const bootstrapped = yield* projects
      .bootstrap({
        commandId: yield* commandId,
        projectId: ProjectId.make(yield* random.uuidV4()),
        title: wiki.name,
        workspaceRoot: wiki.root,
      })
      .pipe(
        Effect.map(({ project }) => project.id),
        Effect.catchTags({
          ProjectInvalidError: (error) =>
            Effect.logWarning("A wiki's folder could not become a project", {
              wiki: wiki.name,
              folder: wiki.root,
              detail: error.detail,
            }).pipe(Effect.as(null)),
        }),
      );
    if (bootstrapped === null) return undefined;
    const rootKey = yield* rootKeyAt(bootstrapped, folder);
    return rootKey === undefined ? undefined : { projectId: bootstrapped, rootKey };
  });

  const placed: Record<string, { readonly projectId: ProjectId; readonly rootKey: RootKey }> = {};
  const droppedMirrors: Array<WikiMigration["droppedMirrors"][number]> = [];
  for (const wiki of registry.wikis) {
    const at = yield* place(wiki);
    if (at === undefined) {
      yield* Effect.logWarning("A wiki was left out of every project", {
        wiki: wiki.name,
        folder: wiki.root,
      });
    } else {
      placed[wiki.wikiId] = at;
    }
    if (wiki.mirror !== null) {
      yield* Effect.logWarning("Mirroring has ended: this wiki's mirror is no longer pushed", {
        wiki: wiki.name,
        url: wiki.mirror.url,
      });
      droppedMirrors.push({ wikiId: wiki.wikiId, name: wiki.name, url: wiki.mirror.url });
    }
  }

  const current = (yield* serverSettings.getSettings).wikiMapBackgrounds;
  const backgrounds = unionBackgrounds(
    current,
    registry.wikis.flatMap((wiki) => wiki.mapBackgrounds),
  );
  if (backgrounds.length !== current.length) {
    yield* serverSettings.updateSettings({ wikiMapBackgrounds: backgrounds });
  }

  // A wiki's change requests live in its repository, which its project root reads.
  const pullRequests = new Map<
    string,
    { kind: "pull-request"; host: string; repository: string; number: number }
  >();
  for (const [wikiId, at] of Object.entries(placed)) {
    const { changeRequests } = yield* wikis
      .changeRequestsList({ wikiId: projectRootId(at.projectId, at.rootKey) })
      .pipe(Effect.orElseSucceed(() => ({ changeRequests: [] })));
    for (const changeRequest of changeRequests) {
      const link = changeRequest.pullRequest;
      const host = link == null ? null : hostOf(link.url);
      if (link == null || host === null) continue;
      pullRequests.set(
        ChangeGroupService.legacyWikiMemberKey(wikiId, changeRequest.changeRequestId),
        { kind: "pull-request", host, repository: link.repository, number: link.number },
      );
    }
  }
  yield* changeGroups.adoptWikiMigration(pullRequests);

  yield* wikis.recordMigration({ version: 1, wikis: placed, droppedMirrors });
  yield* fileSystem.rename(registryPath, path.join(config.stateDir, RETIRED_WIKI_REGISTRY_FILE));
  yield* Effect.logInfo("Moved registered wikis into projects", {
    wikis: registry.wikis.length,
    placed: Object.keys(placed).length,
    droppedMirrors: droppedMirrors.length,
  });
});

/** Runs the migration once the server is active; a failed run tries again at the next start. */
export const layer = Layer.effectDiscard(
  forkParked(
    migrateWikis().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(
          "Moving registered wikis into projects failed; it runs again next start",
          {
            cause: Cause.pretty(cause),
          },
        ),
      ),
    ),
  ),
);
