/**
 * GroundingFold — canonical runtime events folded into the grounding items a
 * planning space shows.
 *
 * "What it looked at is shown" needs one legible shape out of several
 * provider vocabularies: Claude reports built-in tools through
 * `tool.progress` and permission requests, Codex through item lifecycle
 * events, and every provider names its tools differently. This module is the
 * one place that drift is absorbed, kept pure so table-driven tests can pin
 * each provider's vocabulary as it is discovered.
 *
 * Command-shaped and file-change-shaped work cannot occur in a planning turn
 * — the approval policy declines it at the runtime — so those fold to
 * nothing, defensively, rather than rendering a provider misbehavior as
 * grounding.
 *
 * @module GroundingFold
 */
import type { PlanGroundingItem, ProviderRuntimeEvent } from "@t3tools/contracts";
import { isToolLifecycleItemType } from "@t3tools/contracts";

/**
 * A grounding item with the identity to deduplicate it by: one tool call can
 * surface as several events (`item.started` then `item.completed`, or a
 * request beside a progress row), and the fold's caller keeps a per-turn set
 * of seen keys so each consultation is shown once.
 */
export interface GroundingFoldResult {
  readonly key: string;
  readonly item: PlanGroundingItem;
}

const READ_TOOL_NAMES = new Set([
  "read",
  "readfile",
  "read_file",
  "view",
  "cat",
  "notebookread",
  "image_view",
]);

const SEARCH_TOOL_NAMES = new Set([
  "grep",
  "search",
  "rg",
  "ripgrep",
  "websearch",
  "web_search",
  "codebase_search",
  "file_search",
  "grep_search",
]);

const LISTING_TOOL_NAMES = new Set(["glob", "ls", "list", "list_dir", "listdirectory", "tree"]);

const isPlanningWriteTool = (toolName: string) =>
  toolName.includes("save_plan_revision") ||
  toolName.includes("save_spec_revision") ||
  toolName.includes("save_implement_proposal");

function classifyToolName(toolName: string): PlanGroundingItem["kind"] {
  const normalized = toolName.trim().toLowerCase();
  if (READ_TOOL_NAMES.has(normalized)) return "file-read";
  if (SEARCH_TOOL_NAMES.has(normalized)) return "search";
  if (LISTING_TOOL_NAMES.has(normalized)) return "listing";
  return "other";
}

function toItem(
  kind: PlanGroundingItem["kind"],
  label: string | undefined,
  detail?: string | undefined,
): PlanGroundingItem | null {
  const trimmed = label?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  const trimmedDetail = detail?.trim();
  return {
    kind,
    label: trimmed,
    ...(trimmedDetail === undefined || trimmedDetail.length === 0 || trimmedDetail === trimmed
      ? {}
      : { detail: trimmedDetail }),
  };
}

/**
 * `tool.progress` summaries usually read "ToolName argument" ("Read
 * apps/server/src/ws.ts", "Grep subscribeTree"). The argument is what a
 * person recognizes; the tool name stays as the kind.
 */
function stripToolPrefix(summary: string, toolName: string): string {
  const prefix = `${toolName} `;
  return summary.startsWith(prefix) ? summary.slice(prefix.length) : summary;
}

/**
 * Fold one runtime event into a grounding item, or nothing when the event is
 * not a consultation. Pure and total; the caller filters to the turn's own
 * thread and deduplicates by {@link GroundingFoldResult.key}.
 */
export function foldGroundingEvent(event: ProviderRuntimeEvent): GroundingFoldResult | null {
  switch (event.type) {
    // The lifecycle vocabulary (Codex, and every provider's MCP tool calls).
    // `item.started` and `item.completed` fold identically — whichever
    // arrives first shows the item, and the key collapses the pair.
    case "item.started":
    case "item.completed": {
      const payload = event.payload;
      if (!isToolLifecycleItemType(payload.itemType)) return null;
      // Work items, not consultations — and impossible under the planning
      // approval policy. Dropped rather than shown.
      if (payload.itemType === "command_execution" || payload.itemType === "file_change") {
        return null;
      }
      const key = event.itemId !== undefined ? `item:${event.itemId}` : `item:${payload.title}`;
      if (payload.itemType === "web_search") {
        const item = toItem("search", payload.title ?? payload.detail ?? "Web search");
        return item === null ? null : { key, item };
      }
      if (payload.itemType === "image_view") {
        const item = toItem("file-read", payload.title ?? payload.detail);
        return item === null ? null : { key, item };
      }
      // MCP and dynamic tool calls: the title is the tool's name, the detail
      // its argument summary when the adapter provides one.
      const title = payload.title;
      if (title === undefined) return null;
      if (isPlanningWriteTool(title)) return null;
      const item = toItem(classifyToolName(title), payload.detail ?? title, payload.detail);
      return item === null ? null : { key, item };
    }

    // Claude's built-in tools surface here with their tool names.
    case "tool.progress": {
      const payload = event.payload;
      const toolName = payload.toolName;
      if (toolName === undefined) return null;
      // The planning MCP door's own tools are the write path, not grounding.
      if (toolName.startsWith("mcp__") || isPlanningWriteTool(toolName)) return null;
      const kind = classifyToolName(toolName);
      const label =
        payload.summary === undefined ? toolName : stripToolPrefix(payload.summary, toolName);
      const key =
        payload.toolUseId !== undefined ? `tool:${payload.toolUseId}` : `tool:${kind}:${label}`;
      const item = toItem(kind, label);
      return item === null ? null : { key, item };
    }

    // A file-read approval names exactly what was consulted, even when no
    // item event follows. The auto-policy has already approved it.
    case "request.opened": {
      if (event.payload.requestType !== "file_read_approval") return null;
      const key = event.requestId !== undefined ? `request:${event.requestId}` : "request:";
      const item = toItem("file-read", event.payload.detail);
      return item === null ? null : { key, item };
    }

    default:
      return null;
  }
}
