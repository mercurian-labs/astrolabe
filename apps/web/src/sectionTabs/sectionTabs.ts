import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";

import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { surfaceIdOf } from "~/panes/arrangement";

/**
 * Astrolabe: every tab belongs to one of the app's sections, and can open in another's panes:
 * a chat in Wikis or Change Requests, a document beside a thread, a pull request beside a
 * document. A tab outside its section offers to open in it (`Open in <section>`). The tab's key
 * says what it shows on its own, so any section's panes can show it and keep it across a reload.
 */
export type SectionId = "threads" | "wikis" | "change-requests";

export const SECTION_LABELS: Readonly<Record<SectionId, string>> = {
  threads: "Threads",
  wikis: "Wikis",
  "change-requests": "Change Requests",
};

const CHAT_PREFIX = "chat:";

/** A chat's tab key, for a thread shown in a pane outside Threads. */
export function chatTabKey(ref: ScopedThreadRef): string {
  return `${CHAT_PREFIX}${encodeURIComponent(ref.environmentId)}:${encodeURIComponent(ref.threadId)}`;
}

/** The thread a chat's tab key names; null for any other key. */
export function parseChatTabKey(key: string): ScopedThreadRef | null {
  if (!key.startsWith(CHAT_PREFIX)) return null;
  const parts = key.slice(CHAT_PREFIX.length).split(":");
  if (parts.length !== 2) return null;
  try {
    const [environmentId, threadId] = parts.map(decodeURIComponent);
    if (!environmentId || !threadId) return null;
    return scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId));
  } catch {
    return null;
  }
}

const isPullRequestKey = (key: string) => surfaceIdOf(key)?.startsWith("pull-request:") ?? false;

/**
 * The section a tab belongs to: chats are Threads', documents Wikis', and change requests (a
 * pull request or a wiki's) Change Requests'. Null for an empty tab, and for the right panel's
 * other surfaces, which never leave their thread.
 */
export function tabSection(key: string): SectionId | null {
  if (parseChatTabKey(key) !== null) return "threads";
  const wiki = parseWikiTabKey(key);
  if (wiki !== null) return wiki.kind === "note" ? "wikis" : "change-requests";
  if (isPullRequestKey(key)) return "change-requests";
  return null;
}

/**
 * The section a set of panes is in, by the key it keeps its arrangement under: the Wikis
 * area's, the Change Requests area's, or a thread's right panel.
 */
export function layoutSection(layoutKey: string | null): SectionId {
  if (layoutKey === "wikis") return "wikis";
  if (layoutKey === "pull-requests") return "change-requests";
  return "threads";
}

/** Whether a key names a chat or a wiki tab, which any section's panes can hold. */
export function isSectionTabKey(key: string): boolean {
  return parseChatTabKey(key) !== null || parseWikiTabKey(key) !== null;
}
