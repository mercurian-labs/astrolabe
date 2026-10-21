import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  describeIndexError,
  describeWikiFailure,
  mergeBlockedReason,
  noteNameOfFile,
} from "@t3tools/client-runtime/wikiLogic";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  changeRequestPullRequests,
  pullRequestNudge,
  unmergedPullRequests,
  type PullRequestNudge,
} from "@t3tools/client-runtime/wikiPullRequests";
import type {
  EnvironmentId,
  ThreadPullRequestLink,
  WikiAmendmentSummary,
  WikiChangeRequestId,
  WikiFileChange,
  WikiId,
  WikiMergePreview,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { LoadingScreen } from "../../components/LoadingScreen";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toolbar } from "../../components/ui/Toolbar";
import { relativeTime } from "../../lib/time";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { wikiEnvironment } from "../../state/wiki";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import type { WikiChangeRequestParams } from "./wikiRoutes";

const STATUS_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

// The amendments arrive oldest first; the list shows the latest on top. (Hermes has no
// Array#toReversed.)
const newestFirst = <T,>(items: ReadonlyArray<T>): T[] =>
  items.map((_, index) => items[items.length - 1 - index]!);

/** Runs a wiki command; resolves to its failure's message, or null on success. */
function useWikiAction<W, A, E>(command: Parameters<typeof useAtomCommand<A, E, W>>[0]) {
  const run = useAtomCommand(command, { reportFailure: false });
  return async (value: W): Promise<string | null> => {
    const result = await run(value);
    if (result._tag === "Success") return null;
    if (isAtomCommandInterrupted(result)) return null;
    return describeWikiFailure(squashAtomCommandFailure(result));
  };
}

/**
 * A wiki change request: whether it merges, each amendment (any one can be reverted), and the
 * documents it changes, each opening inside it. Merge, Close and Reopen sit in the header's
 * menu; merging asks first, since it writes into the wiki's folder.
 */
export function WikiChangeRequestRouteScreen({
  route,
}: StaticScreenProps<WikiChangeRequestParams>) {
  const navigation = useNavigation();
  const environmentId = route.params.environmentId as EnvironmentId;
  const wikiId = route.params.wikiId as WikiId;
  const changeRequestId = route.params.changeRequestId as WikiChangeRequestId;
  const target = { wikiId, changeRequestId };
  const detail = useEnvironmentQuery(
    wikiEnvironment.changeRequest({ environmentId, input: target }),
  );
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const wikiName = wikis.data?.wikis.find((entry) => entry.wikiId === wikiId)?.name ?? null;
  const canMerge = useAtomValue(wikiEnvironment.merge.permissionAtom(environmentId));
  const canSetStatus = useAtomValue(
    wikiEnvironment.setChangeRequestStatus.permissionAtom(environmentId),
  );
  // Astrolabe: the pull requests of the thread that wrote it (see `wikiPullRequests`).
  const writer = detail.data?.changeRequest.threadId ?? null;
  const thread = useThreadShell(writer === null ? null : scopeThreadRef(environmentId, writer));
  const pullRequestLinks = thread?.pullRequests ?? NO_LINKS;
  const merge = useWikiAction(wikiEnvironment.merge);
  const setStatus = useWikiAction(wikiEnvironment.setChangeRequestStatus);
  const [busy, setBusy] = useState(false);

  const act = async (run: () => Promise<string | null>, failureTitle: string) => {
    setBusy(true);
    const failure = await run();
    setBusy(false);
    if (failure) Dialog.alert(failureTitle, failure);
  };

  if (detail.data === null) {
    return (
      <View className="flex-1 bg-screen">
        <NativeStackScreenOptions options={{ title: "Change request" }} />
        {detail.error !== null ? (
          <EmptyState title="Couldn't open this change request" detail={detail.error} />
        ) : (
          <LoadingScreen message="Opening the change request…" />
        )}
      </View>
    );
  }

  const { changeRequest, files, mergePreview } = detail.data;
  const open = changeRequest.status === "open";
  const blocked = mergeBlockedReason({ canWrite: canMerge, preview: mergePreview });
  const errors = (open ? mergePreview.errors : detail.data.errors).map(describeIndexError);
  const threadId = changeRequest.threadId;

  // Merging the docs before the code is allowed, after saying so.
  const waiting = unmergedPullRequests(pullRequestLinks);
  const nudge = pullRequestNudge(changeRequest.status, pullRequestLinks);
  const confirmMerge = () =>
    Dialog.confirm({
      title: "Merge into main?",
      message: [
        `“${changeRequest.title}” is written into ${wikiName ?? "the wiki"}'s folder and pushed to its mirror.`,
        waiting.length > 0
          ? `${waiting.length === 1 ? "Pull request" : "Pull requests"} ${waiting.map((link) => `#${link.number}`).join(", ")} ${waiting.length === 1 ? "hasn't" : "haven't"} merged yet, so these docs would describe code that isn't on main.`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      confirmText: "Merge",
      onConfirm: () => void act(() => merge({ environmentId, input: target }), "Couldn't merge"),
    });

  const openDocument = (change: WikiFileChange) =>
    navigation.dispatch(
      StackActions.push("WikiDocument", {
        environmentId: route.params.environmentId,
        wikiId: route.params.wikiId,
        name: noteNameOfFile(change.file),
        // A merged or closed change request's documents are read from main.
        ...(open ? { changeRequestId: route.params.changeRequestId } : {}),
      }),
    );

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        options={{
          title: "Change request",
          unstable_headerSubtitle: [wikiName, STATUS_LABEL[changeRequest.status]]
            .filter(Boolean)
            .join(" · "),
        }}
        optionsVersion={`${changeRequest.status}|${wikiName}`}
      />
      <Toolbar placement="right">
        <Toolbar.Menu
          icon="ellipsis"
          title={changeRequest.title}
          accessibilityLabel="Change request actions"
          disabled={busy}
        >
          {open ? (
            <Toolbar.MenuAction
              icon={PullRequestGlyph.merged}
              disabled={blocked !== null}
              {...(blocked === null ? {} : { subtitle: blocked })}
              onPress={confirmMerge}
            >
              <Toolbar.Label>Merge into main</Toolbar.Label>
            </Toolbar.MenuAction>
          ) : null}
          {open ? (
            <Toolbar.MenuAction
              icon="xmark.circle"
              disabled={!canSetStatus}
              onPress={() =>
                void act(
                  () => setStatus({ environmentId, input: { ...target, status: "closed" } }),
                  "Couldn't close",
                )
              }
            >
              <Toolbar.Label>Close</Toolbar.Label>
            </Toolbar.MenuAction>
          ) : changeRequest.status === "closed" ? (
            <Toolbar.MenuAction
              icon="arrow.uturn.backward.circle"
              disabled={!canSetStatus}
              onPress={() =>
                void act(
                  () => setStatus({ environmentId, input: { ...target, status: "open" } }),
                  "Couldn't reopen",
                )
              }
            >
              <Toolbar.Label>Reopen</Toolbar.Label>
            </Toolbar.MenuAction>
          ) : null}
          {threadId ? (
            <Toolbar.MenuAction
              icon="text.bubble"
              onPress={() =>
                navigation.dispatch(StackActions.push("Thread", { environmentId, threadId }))
              }
            >
              <Toolbar.Label>Open thread</Toolbar.Label>
            </Toolbar.MenuAction>
          ) : null}
        </Toolbar.Menu>
      </Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pt-4 pb-16"
      >
        <View className="gap-1.5">
          <Text className="text-xl font-t3-bold text-foreground">{changeRequest.title}</Text>
          <Text className="text-sm text-foreground-muted">
            {[
              `Opened by ${changeRequest.createdBy} ${relativeTime(changeRequest.createdAt)}`,
              changeRequest.mergedCommit
                ? `Merged as ${changeRequest.mergedCommit.slice(0, 7)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        {thread ? (
          <LinkedPullRequests
            links={pullRequestLinks}
            nudge={nudge}
            busy={busy}
            canMerge={blocked === null}
            canClose={canSetStatus}
            onMerge={confirmMerge}
            onClose={() =>
              void act(
                () => setStatus({ environmentId, input: { ...target, status: "closed" } }),
                "Couldn't close",
              )
            }
            onOpen={(link) =>
              navigation.dispatch(
                StackActions.push("PullRequest", {
                  environmentId: route.params.environmentId,
                  projectId: String(thread.projectId),
                  repository: link.repository,
                  number: link.number,
                  host: link.host,
                }),
              )
            }
          />
        ) : null}
        {open ? <MergePreview preview={mergePreview} /> : null}
        {errors.length > 0 ? (
          <Card>
            <Text className="text-sm font-t3-medium text-foreground">
              {open ? "Standing after the merge" : "Standing errors"}
            </Text>
            {errors.map((error) => (
              <Text key={error} className="text-sm text-foreground-muted">
                {error}
              </Text>
            ))}
          </Card>
        ) : null}
        <Section title={`Amendments (${changeRequest.amendments.length})`}>
          {changeRequest.amendments.length === 0 ? (
            <Text className="px-4 text-sm text-foreground-muted">No amendments yet.</Text>
          ) : (
            <View className="overflow-hidden rounded-[20px] bg-grouped-card">
              {newestFirst(changeRequest.amendments).map((amendment, index) => (
                <AmendmentRow
                  key={amendment.commit}
                  environmentId={environmentId}
                  target={target}
                  amendment={amendment}
                  canRevert={open}
                  first={index === 0}
                />
              ))}
            </View>
          )}
        </Section>
        <Section title={`Documents changed (${files.length})`}>
          {files.length === 0 ? (
            <Text className="px-4 text-sm text-foreground-muted">
              This change request changes no documents.
            </Text>
          ) : (
            <View className="overflow-hidden rounded-[20px] bg-grouped-card">
              {files.map((change, index) => (
                <Pressable
                  key={change.file}
                  accessibilityRole="button"
                  disabled={change.after === null}
                  onPress={() => openDocument(change)}
                  className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
                >
                  <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                    {noteNameOfFile(change.file)}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {change.before === null
                      ? "Added"
                      : change.after === null
                        ? "Deleted"
                        : "Changed"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

const NO_LINKS: ReadonlyArray<ThreadPullRequestLink> = [];
const PULL_REQUEST_STATE_LABEL = { open: "Open", merged: "Merged", closed: "Closed" } as const;

/**
 * Astrolabe: the writing thread's pull requests, each opening its review, and once they settle
 * the change request's offer to follow: merge when one merged, close when every one closed
 * without merging. Nothing happens on its own.
 */
function LinkedPullRequests(props: {
  readonly links: ReadonlyArray<ThreadPullRequestLink>;
  readonly nudge: PullRequestNudge | null;
  readonly busy: boolean;
  readonly canMerge: boolean;
  readonly canClose: boolean;
  readonly onMerge: () => void;
  readonly onClose: () => void;
  readonly onOpen: (link: ThreadPullRequestLink) => void;
}) {
  const linked = changeRequestPullRequests(props.links);
  if (linked.length === 0) return null;
  const { nudge } = props;
  return (
    <Section title="Pull requests">
      <View className="overflow-hidden rounded-[20px] bg-grouped-card">
        {linked.map((link, index) => {
          const state = link.snapshot?.state ?? null;
          return (
            <Pressable
              key={`${link.host}:${link.repository}:${link.number}`}
              accessibilityRole="button"
              accessibilityHint="Opens the pull request."
              onPress={() => props.onOpen(link)}
              className={`gap-0.5 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <Text className="text-base text-foreground" numberOfLines={1}>
                {link.snapshot?.title ?? link.repository}
              </Text>
              {/* The number leads the second line, so a long title never hides it. */}
              <Text className="text-sm text-foreground-muted">
                {`#${link.number} · ${state === null ? "Not read yet" : PULL_REQUEST_STATE_LABEL[state]}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {nudge ? (
        <Card>
          <Text className="text-sm font-t3-medium text-foreground">
            {nudge.kind === "merge"
              ? `Pull request #${nudge.pullRequest.number} merged`
              : `Pull request #${nudge.pullRequest.number} closed without merging`}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {nudge.kind === "merge"
              ? "Merge these docs too, so the wiki matches the code on main?"
              : "Close this change request too?"}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={props.busy || (nudge.kind === "merge" ? !props.canMerge : !props.canClose)}
            onPress={nudge.kind === "merge" ? props.onMerge : props.onClose}
            className="self-start pt-1 active:opacity-60 disabled:opacity-40"
          >
            <Text className="text-sm font-t3-medium text-link">
              {nudge.kind === "merge" ? "Merge docs" : "Close change request"}
            </Text>
          </Pressable>
        </Card>
      ) : null}
    </Section>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-t3-medium text-foreground-muted">{props.title}</Text>
      {props.children}
    </View>
  );
}

function Card(props: { readonly children: ReactNode }) {
  return <View className="gap-1.5 rounded-[20px] bg-grouped-card px-4 py-3">{props.children}</View>;
}

function MergePreview({ preview }: { readonly preview: WikiMergePreview }) {
  return (
    <Card>
      <Text className="text-sm font-t3-medium text-foreground">
        {preview.status === "clean"
          ? "Merges cleanly into main."
          : preview.status === "conflict"
            ? "Conflicts with main"
            : "Main already has these changes."}
      </Text>
      {preview.status === "conflict" ? (
        <Text className="text-sm text-foreground-muted">
          {preview.conflicts.length > 0
            ? `Edited on both sides: ${preview.conflicts.join(", ")}. Amend this change request to settle them, then merge.`
            : "Amend this change request to settle the conflict, then merge."}
        </Text>
      ) : null}
    </Card>
  );
}

/** One amendment: what it did, who, when, and to which documents; it can be reverted. */
function AmendmentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly target: { readonly wikiId: WikiId; readonly changeRequestId: WikiChangeRequestId };
  readonly amendment: WikiAmendmentSummary;
  readonly canRevert: boolean;
  readonly first: boolean;
}) {
  const { amendment } = props;
  const canWrite = useAtomValue(
    wikiEnvironment.revertAmendment.permissionAtom(props.environmentId),
  );
  const revert = useWikiAction(wikiEnvironment.revertAmendment);
  const [busy, setBusy] = useState(false);
  return (
    <View
      className={`flex-row items-start gap-3 px-4 py-3 ${props.first ? "" : "border-t border-border-subtle"}`}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base text-foreground">
          {amendment.reverts ? "Revert: " : null}
          {amendment.subject}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {`${amendment.actor} · ${relativeTime(amendment.at)} · ${amendment.files.map(noteNameOfFile).join(", ")}`}
        </Text>
      </View>
      {props.canRevert ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Revert ${amendment.subject}`}
          disabled={!canWrite || busy}
          hitSlop={8}
          onPress={async () => {
            setBusy(true);
            const failure = await revert({
              environmentId: props.environmentId,
              input: { ...props.target, commit: amendment.commit },
            });
            setBusy(false);
            if (failure) Dialog.alert("Couldn't revert", failure);
          }}
          className="disabled:opacity-40"
        >
          <Text className="text-sm font-t3-medium text-primary">
            {busy ? "Reverting…" : "Revert"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
