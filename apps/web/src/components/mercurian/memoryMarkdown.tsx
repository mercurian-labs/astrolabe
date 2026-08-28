import rehypeSanitize from "rehype-sanitize";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createContext, use, useMemo } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const NOTE_HREF_PREFIX = "#note/";
const WIKILINK_PATTERN = new RegExp("\\[\\[([^\\[\\]\\n|]+?)(?:\\|([^\\[\\]\\n|]+?))?\\]\\]", "g");

const MemoryMarkdownContext = createContext<{
  readonly resolution: ReadonlyMap<string, boolean>;
  readonly onOpenNote: (name: string) => void;
} | null>(null);

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

function noteLink(name: string, label: string): MarkdownNode {
  return {
    type: "link",
    url: `${NOTE_HREF_PREFIX}${encodeURIComponent(name)}`,
    children: [{ type: "text", value: label }],
  };
}

function splitWikilinks(node: MarkdownNode): ReadonlyArray<MarkdownNode> {
  const value = node.value ?? "";
  const children: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(WIKILINK_PATTERN)) {
    const index = match.index ?? 0;
    const name = (match[1] ?? "").trim();
    const alias = match[2]?.trim();
    if (!name || (match[2] !== undefined && !alias)) continue;
    if (index > cursor) children.push({ type: "text", value: value.slice(cursor, index) });
    children.push(noteLink(name, alias ?? name));
    cursor = index + match[0].length;
  }
  if (cursor < value.length) children.push({ type: "text", value: value.slice(cursor) });
  return children.length === 0 ? [node] : children;
}

function rewriteTextChildren(parent: MarkdownNode): void {
  if (parent.type === "link" || parent.type === "linkReference") return;
  const next: MarkdownNode[] = [];
  for (const child of parent.children ?? []) {
    if (child.type === "text") next.push(...splitWikilinks(child));
    else {
      if (child.children !== undefined) rewriteTextChildren(child);
      next.push(child);
    }
  }
  parent.children = next;
}

/** Code and inline-code nodes carry values, not text children, so traversal leaves them untouched. */
function remarkMemoryWikilinks() {
  return (tree: MarkdownNode) => rewriteTextChildren(tree);
}

const MemoryMarkdownAnchor: NonNullable<Components["a"]> = ({
  href,
  children,
  node: _node,
  ...props
}) => {
  const context = use(MemoryMarkdownContext);
  if (!href?.startsWith(NOTE_HREF_PREFIX) || context === null) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  const name = decodeURIComponent(href.slice(NOTE_HREF_PREFIX.length));
  const exists = context.resolution.get(name.toLocaleLowerCase()) === true;
  const chip = (
    <button
      type="button"
      className={cn(
        "inline cursor-pointer underline",
        !exists && "text-destructive-foreground decoration-dashed underline-offset-2",
      )}
      aria-label={exists ? undefined : `${name}, not yet written`}
      onClick={() => context.onOpenNote(name)}
    >
      {children}
    </button>
  );
  if (exists) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup>Not yet written</TooltipPopup>
    </Tooltip>
  );
};

export function MemoryMarkdown({
  markdown,
  links,
  onOpenNote,
  className,
}: {
  readonly markdown: string;
  readonly links: ReadonlyArray<{ readonly name: string; readonly exists: boolean }>;
  readonly onOpenNote: (name: string) => void;
  readonly className?: string;
}) {
  const contextValue = useMemo(
    () => ({
      resolution: new Map(links.map((link) => [link.name.toLocaleLowerCase(), link.exists])),
      onOpenNote,
    }),
    [links, onOpenNote],
  );

  return (
    <MemoryMarkdownContext value={contextValue}>
      <div
        className={cn(
          "text-sm text-foreground",
          "[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
          "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold first:[&_h1]:mt-0",
          "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold first:[&_h2]:mt-0",
          "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium",
          "[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/60 [&_pre]:p-3",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
          className,
        )}
      >
        <ReactMarkdown
          rehypePlugins={[rehypeSanitize]}
          remarkPlugins={[remarkGfm, remarkMemoryWikilinks]}
          components={{ a: MemoryMarkdownAnchor }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </MemoryMarkdownContext>
  );
}
