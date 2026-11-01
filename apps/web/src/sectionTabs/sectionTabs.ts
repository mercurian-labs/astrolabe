import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";

import { parseChangeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";

/**
 * Astrolabe: every tab belongs to one of the app's sections, and all of them share one set of
 * panes: a chat beside a document, a pull request beside a repository file. The tab's key says
 * what it shows on its own, so the panes can show it anywhere and keep it across a reload.
 */

const CHAT_PREFIX = "chat:";

/** A chat's tab key. */
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

/** Whether a key names a chat, wiki or repository tab, which any section's panes can hold. */
export function isSectionTabKey(key: string): boolean {
  return (
    parseChatTabKey(key) !== null ||
    parseWikiTabKey(key) !== null ||
    parseRepositoryTabKey(key) !== null ||
    parseChangeGroupTabKey(key) !== null
  );
}
