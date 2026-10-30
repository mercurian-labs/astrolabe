import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { WikiChangeEntry, WikiDocumentEntry } from "@t3tools/client-runtime/wikiList";
import { isTurnRunning } from "@t3tools/client-runtime/wikiLogic";
import type { EnvironmentId, ThreadId, WikiSummary } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import { projectMonogram } from "../../lib/projectIcon";
import { relativeTime } from "../../lib/time";
import { useThreadShell } from "../../state/entities";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { THREAD_LIST_V2_WORKING_LABEL as WORKING } from "../threads/thread-list-v2-items";
import {
  THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME,
  THREAD_LIST_V2_ROW_DIVIDERS,
  THREAD_LIST_V2_SCREEN_ROW as ROW,
} from "../threads/thread-list-v2-row-appearance";
import { wikiChangeFooter, wikiDocumentFooter } from "./wikisList";

/** A wiki's icon: a monogram of its name. */
function WikiIcon(props: { readonly environmentId: EnvironmentId; readonly wiki: WikiSummary }) {
  return (
    <ProjectFavicon
      environmentId={props.environmentId}
      projectIcon={{ kind: "monogram", text: projectMonogram(props.wiki.name), color: "gray" }}
      size={15}
      projectTitle={props.wiki.name}
    />
  );
}

/** Whether the agent of a change request's thread is mid-turn. */
function useAgentWorking(environmentId: EnvironmentId, threadId: ThreadId | null | undefined) {
  const shell = useThreadShell(
    threadId === null || threadId === undefined ? null : scopeThreadRef(environmentId, threadId),
  );
  return isTurnRunning(shell?.source.status);
}

/**
 * The frame both rows share, a thread row's: the wiki and a time or "Working" on one line, a
 * title, and a footer, on the screen's surface with an inset hairline below.
 */
function WikiRowFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly timestamp: string | null;
  readonly working: boolean;
  readonly title: string;
  readonly accessibilityLabel: string;
  readonly accessibilityHint: string;
  readonly showTrailingDivider: boolean;
  readonly onPress: () => void;
  readonly footer: ReactNode;
}) {
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.accessibilityHint}
      className={ROW.className}
      interactionClassName={ROW.interactionClassName}
      onPress={props.onPress}
    >
      <View>
        <View className={THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME}>
          <View className="flex-row items-center gap-1.5">
            <WikiIcon environmentId={props.environmentId} wiki={props.wiki} />
            <Text
              className={cn("flex-1 text-sm font-t3-medium", ROW.mutedForegroundClassName)}
              numberOfLines={1}
            >
              {props.wiki.name}
            </Text>
            {props.working ? (
              <View className="flex-row items-center gap-1">
                <SymbolView
                  name={WORKING.icon}
                  size={13}
                  tintColorClassName={WORKING.iconTintClassName}
                  type="monochrome"
                  weight="semibold"
                />
                <Text className={cn("text-xs font-t3-bold", WORKING.className)}>
                  {WORKING.label}
                </Text>
              </View>
            ) : props.timestamp ? (
              <Text className={cn("text-xs tabular-nums", ROW.tertiaryForegroundClassName)}>
                {relativeTime(props.timestamp)}
              </Text>
            ) : null}
          </View>
          <Text
            className={cn("mt-1 text-base font-t3-medium", ROW.foregroundClassName)}
            numberOfLines={2}
          >
            {props.title}
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">{props.footer}</View>
        </View>
        {THREAD_LIST_V2_ROW_DIVIDERS && props.showTrailingDivider ? (
          <View className="ml-5 h-px bg-border-subtle" />
        ) : null}
      </View>
    </RowPressable>
  );
}

/** A document: its wiki and when it last changed, its name, and its links or open change. */
export const WikiDocumentRow = memo(function WikiDocumentRow(props: {
  readonly entry: WikiDocumentEntry;
  readonly showTrailingDivider: boolean;
  readonly onSelect: (entry: WikiDocumentEntry) => void;
}) {
  const { entry, onSelect } = props;
  const working = useAgentWorking(entry.environmentId, entry.changes[0]?.threadId);
  const footer = wikiDocumentFooter(entry);
  return (
    <WikiRowFrame
      environmentId={entry.environmentId}
      wiki={entry.wiki}
      timestamp={entry.editedAt}
      working={working}
      title={entry.name}
      accessibilityLabel={`${entry.name}, ${entry.wiki.name}`}
      accessibilityHint="Opens the document"
      showTrailingDivider={props.showTrailingDivider}
      onPress={() => onSelect(entry)}
      footer={
        <>
          {footer.inChange ? (
            <SymbolView
              name="square.and.pencil"
              size={11}
              tintColorClassName={ROW.mutedIconTintClassName}
              type="monochrome"
            />
          ) : null}
          <Text
            className={cn(
              "min-w-0 flex-1 text-xs",
              footer.inChange ? ROW.mutedForegroundClassName : ROW.tertiaryForegroundClassName,
            )}
            numberOfLines={1}
          >
            {footer.text}
          </Text>
        </>
      }
    />
  );
});

const CHANGE_STATUS_ICON = {
  open: PullRequestGlyph.pullRequest,
  merged: PullRequestGlyph.merged,
  closed: PullRequestGlyph.closed,
} as const;

/** A change request: its wiki and when it last moved, its title, and what it holds. */
export const WikiChangeRow = memo(function WikiChangeRow(props: {
  readonly entry: WikiChangeEntry;
  readonly showTrailingDivider: boolean;
  readonly onSelect: (entry: WikiChangeEntry) => void;
}) {
  const { entry, onSelect } = props;
  const { changeRequest } = entry;
  const working = useAgentWorking(entry.environmentId, changeRequest.threadId);
  const footer = wikiChangeFooter(entry);
  return (
    <WikiRowFrame
      environmentId={entry.environmentId}
      wiki={entry.wiki}
      timestamp={changeRequest.updatedAt}
      working={working}
      title={changeRequest.title}
      accessibilityLabel={`${changeRequest.title}, change request in ${entry.wiki.name}`}
      accessibilityHint="Opens the change request"
      showTrailingDivider={props.showTrailingDivider}
      onPress={() => onSelect(entry)}
      footer={
        <>
          <SymbolView
            name={CHANGE_STATUS_ICON[changeRequest.status]}
            size={12}
            tintColorClassName={ROW.tertiaryIconTintClassName}
          />
          <Text
            className={cn("min-w-0 flex-1 text-xs", ROW.tertiaryForegroundClassName)}
            numberOfLines={1}
          >
            {footer.summary}
          </Text>
          {footer.actors ? (
            <Text
              className={cn("max-w-[45%] text-xs", ROW.mutedForegroundClassName)}
              numberOfLines={1}
            >
              {footer.actors}
            </Text>
          ) : null}
        </>
      }
    />
  );
});
