import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";
import { Keyboard, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { relativeTime } from "../../lib/time";
import { useProjects, useServerConfigs } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { repositoryScopeAtom } from "../../state/repositories";
import { reviewEnvironment } from "../../state/review";
import { vcsEnvironment } from "../../state/vcs";
import { changeRequestProjectKindAtom } from "../../state/wiki";
import { useWorkspaceState } from "../../state/workspace";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { ThreadListV2SectionDivider } from "../threads/thread-list-v2-items";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";

const repositoryKey = (project: Pick<EnvironmentProject, "environmentId" | "id">) =>
  `${project.environmentId}:${project.id}`;

/**
 * Astrolabe: the Repositories tab, as web's Repositories section lists a repository: with one
 * picked, its uncommitted changes, then the files its commits changed most recently, and a row
 * into its whole file tree; with every repository, each one's latest files. A file opens read
 * only, as a thread's Files view shows it; editing code stays on the computer for now.
 */
export function RepositoriesScreen() {
  const workspace = useWorkspaceTabs()!;
  const insets = useSafeAreaInsets();
  const { environments } = useWorkspaceState();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const scope = useAtomValue(repositoryScopeAtom);
  const setScope = useAtomSet(repositoryScopeAtom);
  const tab = workspace.state.tabs.repositories;
  const query = tab.searchMode === "resting" ? "" : tab.query.trim();
  const connected = useMemo(
    () =>
      new Set(
        environments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const repositories = useMemo(
    () =>
      [...projects]
        .filter(
          (project) =>
            connected.has(project.environmentId) &&
            !isScratchProject(
              project,
              serverConfigs.get(project.environmentId)?.scratchWorkspaceRoot,
            ),
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
    [connected, projects, serverConfigs],
  );
  const scoped = repositories.find((repository) => repositoryKey(repository) === scope) ?? null;
  // A name on two machines is told apart by the machine.
  const labelOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const repository of repositories) {
      counts.set(repository.title, (counts.get(repository.title) ?? 0) + 1);
    }
    const machine = new Map(
      environments.map((environment) => [environment.environmentId, environment.environmentLabel]),
    );
    return (repository: EnvironmentProject) =>
      (counts.get(repository.title) ?? 0) > 1
        ? `${repository.title} · ${machine.get(repository.environmentId) ?? "Environment"}`
        : repository.title;
  }, [environments, repositories]);

  return (
    <View className="flex-1 bg-screen">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, workspace.bottomClearance),
        }}
      >
        {repositories.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingBottom: 8 }}
          >
            <ListFilterMenu
              label={scoped ? labelOf(scoped) : "All projects"}
              accessibilityLabel="Filter by project"
              active={scoped !== null}
              actions={[
                { id: "all", title: "All projects", state: scoped ? "off" : "on" },
                ...repositories.map((repository) => ({
                  id: repositoryKey(repository),
                  title: labelOf(repository),
                  state: repository === scoped ? ("on" as const) : ("off" as const),
                })),
              ]}
              onSelect={(id) => setScope(id === "all" ? null : id)}
            />
          </ScrollView>
        ) : null}
        {repositories.length === 0 ? (
          <View className="px-8 py-12">
            <EmptyState
              title={environments.length === 0 ? "Connect an environment" : "No projects yet"}
              detail={
                environments.length === 0
                  ? "Add an environment in Settings to browse its projects."
                  : "Add a project from Astrolabe on your computer."
              }
              variant="plain"
            />
          </View>
        ) : scoped ? (
          <RepositoryList repository={scoped} label={labelOf(scoped)} query={query} full />
        ) : (
          repositories.map((repository) => (
            <RepositoryList
              key={repositoryKey(repository)}
              repository={repository}
              label={labelOf(repository)}
              query={query}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One repository's files. `full`: its uncommitted changes, a row into its file tree and its
 * change requests, then 40 recent files, and search over every file by name; otherwise under
 * its name, its eight latest files, which search narrows by name.
 */
function RepositoryList({
  repository,
  label,
  query,
  full = false,
}: {
  readonly repository: EnvironmentProject;
  readonly label: string;
  readonly query: string;
  readonly full?: boolean;
}) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs()!;
  const setChangeRequestKind = useAtomSet(changeRequestProjectKindAtom);
  const { environmentId } = repository;
  const cwd = repository.workspaceRoot;
  const status = useEnvironmentQuery(
    full ? vcsEnvironment.status({ environmentId, input: { cwd } }) : null,
  );
  const recent = useEnvironmentQuery(
    reviewEnvironment.recentFiles({ environmentId, input: { cwd, limit: full ? 40 : 8 } }),
  );
  const search = useEnvironmentQuery(
    full && query.length > 0
      ? projectEnvironment.searchEntries({
          environmentId,
          input: { cwd, query, limit: 50, kind: "file" },
        })
      : null,
  );
  const openFile = (path: string) => {
    Keyboard.dismiss();
    // The root stack's file screen, reached from inside the tabs as a wiki document is.
    navigation.navigate("RepositoryFile", {
      environmentId: String(environmentId),
      cwd,
      projectName: repository.title,
      path: path.split("/").filter(Boolean),
    });
  };
  const matches = (path: string) =>
    query.length === 0 || path.toLowerCase().includes(query.toLowerCase());

  if (full && query.length > 0) {
    const entries = search.data?.entries ?? [];
    return (
      <View>
        {entries.map((entry) => (
          <FileRow key={entry.path} path={entry.path} onPress={() => openFile(entry.path)} />
        ))}
        {entries.length === 0 ? (
          <Text className="px-4 py-6 text-center text-sm text-foreground-muted">
            {search.isPending ? "Searching…" : "No files found"}
          </Text>
        ) : null}
      </View>
    );
  }

  const uncommitted = (status.data?.workingTree.files ?? []).filter((file) => matches(file.path));
  const uncommittedPaths = new Set(uncommitted.map((file) => file.path));
  const recentFiles = (recent.data?.files ?? []).filter(
    (file) => !uncommittedPaths.has(file.path) && matches(file.path),
  );
  if (!full && recentFiles.length === 0) return null;
  return (
    <View>
      {full ? null : <ThreadListV2SectionDivider label={label} />}
      {full ? (
        <>
          <LinkRow
            icon="folder"
            label="Browse all files"
            onPress={() =>
              navigation.navigate("RepositoryFiles", {
                environmentId: String(environmentId),
                cwd,
                projectName: repository.title,
              })
            }
          />
          <LinkRow
            icon={PullRequestGlyph.pullRequest}
            label="Changes"
            onPress={() => {
              setChangeRequestKind("repositories");
              workspace.dispatch({ type: "select", tab: "pullRequests" });
            }}
          />
        </>
      ) : null}
      {uncommitted.length > 0 ? (
        <>
          <ThreadListV2SectionDivider label={`Uncommitted · ${uncommitted.length}`} />
          {uncommitted.map((file) => (
            <FileRow
              key={file.path}
              path={file.path}
              trailing={`+${file.insertions} −${file.deletions}`}
              onPress={() => openFile(file.path)}
            />
          ))}
        </>
      ) : null}
      {full && recentFiles.length > 0 ? (
        <ThreadListV2SectionDivider label="Recently changed" />
      ) : null}
      {recentFiles.map((file) => (
        <FileRow
          key={file.path}
          path={file.path}
          trailing={relativeTime(file.changedAt)}
          onPress={() => openFile(file.path)}
        />
      ))}
    </View>
  );
}

function LinkRow(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className="flex-row items-center gap-2 px-4 py-3 active:opacity-60"
    >
      <SymbolView name={props.icon} size={15} tintColorClassName="accent-icon" />
      <Text className="flex-1 text-sm font-t3-medium text-foreground-muted">{props.label}</Text>
      <SymbolView name="chevron.right" size={13} tintColorClassName="accent-icon" />
    </Pressable>
  );
}

/** A file: its name, its folder beneath, and its age or line counts. */
function FileRow(props: {
  readonly path: string;
  readonly trailing?: string;
  readonly onPress: () => void;
}) {
  const slash = props.path.lastIndexOf("/");
  const name = props.path.slice(slash + 1);
  const folder = slash === -1 ? "" : props.path.slice(0, slash);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.path}
      onPress={props.onPress}
      className="flex-row items-center gap-3 px-4 py-2.5 active:opacity-60"
    >
      <SymbolView name="doc.text" size={16} tintColorClassName="accent-icon" />
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] text-foreground" numberOfLines={1}>
          {name}
        </Text>
        {folder ? (
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {folder}
          </Text>
        ) : null}
      </View>
      {props.trailing ? (
        <Text className="text-xs tabular-nums text-foreground-muted">{props.trailing}</Text>
      ) : null}
    </Pressable>
  );
}
