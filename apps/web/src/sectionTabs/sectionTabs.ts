import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";

import { parseChangeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { surfaceIdOf } from "~/panes/arrangement";

/**
 * Astrolabe: every tab belongs to one of the app's sections, and can open in another's panes:
 * a chat in Wikis or Change Requests, a document beside a thread, a pull request beside a
 * document. A tab outside its section offers to open in it (`Open in <section>`). The tab's key
 * says what it shows on its own, so any section's panes can show it and keep it across a reload.
 */
export type SectionId = "threads" | "wikis" | "repositories" | "change-requests";

export const SECTION_LABELS: Readonly<Record<SectionId, string>> = {
  threads: "Agents",
  wikis: "Wikis",
  repositories: "Repositories",
  "change-requests": "Changes",
};

const CHAT_PREFIX = "chat:";

/** A chat's tab key, for a thread shown in a pane outside Agents. */
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

const CHAT_SURFACE_PREFIX = "chat-surface:";

/**
 * Astrolabe: one of a thread's right-panel surfaces as a tab of the shared panes, named with its
 * thread so every thread's terminal, browser and diff is a tab of its own, linked to its chat.
 */
export function chatSurfaceKey(chatKey: string, surfaceId: string): string {
  return `${CHAT_SURFACE_PREFIX}${chatKey.slice(CHAT_PREFIX.length)}:${surfaceId}`;
}

/** The chat (by its tab key) and surface a thread's surface tab names; null for any other key. */
export function parseChatSurfaceKey(
  key: string,
): { readonly chatKey: string; readonly surfaceId: string } | null {
  if (!key.startsWith(CHAT_SURFACE_PREFIX)) return null;
  const rest = key.slice(CHAT_SURFACE_PREFIX.length);
  const first = rest.indexOf(":");
  const second = first === -1 ? -1 : rest.indexOf(":", first + 1);
  if (second === -1 || second === rest.length - 1) return null;
  const chatKey = `${CHAT_PREFIX}${rest.slice(0, second)}`;
  if (parseChatTabKey(chatKey) === null) return null;
  return { chatKey, surfaceId: rest.slice(second + 1) };
}

const isPullRequestKey = (key: string) =>
  (surfaceIdOf(key) ?? parseChatSurfaceKey(key)?.surfaceId)?.startsWith("pull-request:") ?? false;

/**
 * The section a tab belongs to: chats are Agents', documents Wikis', files and diffs
 * Repositories', and change requests (a pull request or a wiki's) Change Requests'. Null for an
 * empty tab, and for the right panel's other surfaces, which never leave their thread.
 */
export function tabSection(key: string): SectionId | null {
  if (parseChatTabKey(key) !== null) return "threads";
  if (parseRepositoryTabKey(key) !== null) return "repositories";
  if (parseChangeGroupTabKey(key) !== null) return "change-requests";
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
  if (layoutKey === "repositories") return "repositories";
  if (layoutKey === "pull-requests") return "change-requests";
  return "threads";
}

/** Whether a key names a chat, wiki or repository tab, which any section's panes can hold. */
export function isSectionTabKey(key: string): boolean {
  return (
    parseChatTabKey(key) !== null ||
    parseWikiTabKey(key) !== null ||
    parseRepositoryTabKey(key) !== null ||
    parseChangeGroupTabKey(key) !== null
  );
}
