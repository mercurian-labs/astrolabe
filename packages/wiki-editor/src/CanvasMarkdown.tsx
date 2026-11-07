import { markdownParser } from "@mercurian/editor/markdown/syntax";
import { memo, Suspense, use, type ReactElement, type ReactNode } from "react";

import { isOpenableUrl } from "./canvasGeometry";
import { wikilinkNoteName } from "./incoming";

/**
 * A card's Markdown as plain elements. A board can hold hundreds of cards and an editor per card
 * is too heavy, so cards read through the editor's parser with no editor. Syntax with no case
 * here shows as its source text.
 */

type SyntaxNode = ReturnType<typeof markdownParser.parse>["topNode"];

/** What Markdown on a board reaches outside itself; without one, that syntax reads as text. */
export interface CanvasMarkdownHost {
  readonly onOpenUrl?: ((href: string) => void) | undefined;
  /** A `[[link]]`, by the note or file it names. */
  readonly onOpenLink?: ((name: string) => void) | undefined;
  /** Whether a link's name is written, which dims one that isn't. */
  readonly isResolved?: ((name: string) => boolean) | undefined;
  /** Puts what a link's hover says around it, when it has something to say. */
  readonly linkHover?: ((name: string, link: ReactElement) => ReactNode) | undefined;
  readonly renderMermaid?: ((source: string) => ReactNode) | undefined;
  /** An `![[embed]]`, by what's between its brackets. */
  readonly renderEmbed?: ((target: string) => ReactNode) | undefined;
  /** A local image a Markdown `![](path)` names. */
  readonly renderImage?: ((path: string) => ReactNode) | undefined;
}

interface Scope {
  readonly source: string;
  readonly host: CanvasMarkdownHost;
}

const MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "ListMark",
  "QuoteMark",
  "LinkMark",
  "LinkTitle",
  "StrikethroughMark",
  "HighlightMark",
  "WikiLinkMark",
  "TaskMarker",
  "TableDelimiter",
  "InlineMathMark",
  "MathBlockMark",
  "CalloutMark",
  "NoteCommentMark",
]);

const childrenOf = (node: SyntaxNode): SyntaxNode[] => {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    children.push(child);
  }
  return children;
};

type Katex = typeof import("katex");
let katexLoad: Promise<Katex | null> | null = null;
const loadKatex = () =>
  (katexLoad ??= import("katex").then(
    (module) => module,
    () => null,
  ));

function TypesetMath({ tex, display }: { readonly tex: string; readonly display: boolean }) {
  const katex = use(loadKatex());
  if (katex === null) return <code>{tex}</code>;
  const markup = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    // KaTeX escapes what it's given, and with `trust` off no command can emit active markup.
    trust: false,
    strict: "ignore",
  });
  return <span dangerouslySetInnerHTML={{ __html: markup }} />;
}

function MathSpan({ tex, display }: { readonly tex: string; readonly display: boolean }) {
  return (
    <Suspense fallback={<code>{tex}</code>}>
      <TypesetMath tex={tex} display={display} />
    </Suspense>
  );
}

function Link({
  href,
  scope,
  children,
}: {
  readonly href: string;
  readonly scope: Scope;
  readonly children: ReactNode;
}) {
  const { onOpenUrl } = scope.host;
  if (!isOpenableUrl(href) || onOpenUrl === undefined) return <span>{children}</span>;
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onOpenUrl(href);
      }}
    >
      {children}
    </a>
  );
}

function WikiLink({ inner, scope }: { readonly inner: string; readonly scope: Scope }) {
  const name = wikilinkNoteName(inner);
  const text = inner.split(/\\?\|/).at(-1) ?? inner;
  const { onOpenLink, isResolved, linkHover } = scope.host;
  const missing = name !== null && isResolved?.(name) === false;
  if (name === null || onOpenLink === undefined) {
    return (
      <span className="cv-wikilink" data-missing={missing || undefined}>
        {text}
      </span>
    );
  }
  const link = (
    <button
      type="button"
      className="cv-wikilink"
      data-missing={missing || undefined}
      onClick={() => onOpenLink(name)}
    >
      {text}
    </button>
  );
  return linkHover === undefined ? link : linkHover(name, link);
}

function inline(node: SyntaxNode, scope: Scope): ReactNode[] {
  const { source, host } = scope;
  const output: ReactNode[] = [];
  let at = node.from;
  for (const child of childrenOf(node)) {
    if (child.from > at) output.push(source.slice(at, child.from));
    at = child.to;
    if (child.name === "HeaderMark") while (source[at] === " ") at++;
    if (MARKS.has(child.name) || child.name === "URL" || child.name === "LinkLabel") continue;
    const key = child.from;
    const inner = () => inline(child, scope);
    switch (child.name) {
      case "Emphasis":
        output.push(<em key={key}>{inner()}</em>);
        break;
      case "StrongEmphasis":
        output.push(<strong key={key}>{inner()}</strong>);
        break;
      case "Strikethrough":
        output.push(<s key={key}>{inner()}</s>);
        break;
      case "Highlight":
        output.push(<mark key={key}>{inner()}</mark>);
        break;
      case "InlineCode":
        output.push(<code key={key}>{inner()}</code>);
        break;
      case "Link":
      case "Autolink": {
        const url = child.getChild("URL");
        const href = url === null ? "" : source.slice(url.from, url.to);
        output.push(
          <Link key={key} href={href} scope={scope}>
            {child.name === "Autolink" ? href : inner()}
          </Link>,
        );
        break;
      }
      case "Image": {
        const url = child.getChild("URL");
        const path = url === null ? "" : source.slice(url.from, url.to);
        output.push(
          /^https?:/i.test(path) ? (
            <img key={key} src={path} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span key={key}>{host.renderImage?.(path) ?? path}</span>
          ),
        );
        break;
      }
      case "WikiLink":
        output.push(
          <WikiLink key={key} inner={source.slice(child.from + 2, child.to - 2)} scope={scope} />,
        );
        break;
      case "Embed": {
        const target = source.slice(child.from + 3, child.to - 2);
        output.push(<span key={key}>{host.renderEmbed?.(target) ?? target}</span>);
        break;
      }
      case "Tag":
        output.push(
          <span key={key} className="cv-tag">
            {source.slice(child.from, child.to)}
          </span>,
        );
        break;
      case "InlineMath": {
        const [open, close] = child.getChildren("InlineMathMark");
        const tex = source.slice(open?.to ?? child.from, close?.from ?? child.to);
        output.push(<MathSpan key={key} tex={tex} display={false} />);
        break;
      }
      case "Escape":
        output.push(source.slice(child.from + 1, child.to));
        break;
      case "HardBreak":
        output.push(<br key={key} />);
        break;
      case "NoteComment":
        break;
      default:
        output.push(child.firstChild === null ? source.slice(child.from, child.to) : inner());
    }
  }
  if (node.to > at) output.push(source.slice(at, node.to));
  return output;
}

function Table({ node, scope }: { readonly node: SyntaxNode; readonly scope: Scope }) {
  const cells = (row: SyntaxNode) => childrenOf(row).filter((child) => child.name === "TableCell");
  const header = node.getChild("TableHeader");
  const rows = childrenOf(node).filter((child) => child.name === "TableRow");
  return (
    <table>
      {header === null ? null : (
        <thead>
          <tr>
            {cells(header).map((cell) => (
              <th key={cell.from}>{inline(cell, scope)}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((row) => (
          <tr key={row.from}>
            {cells(row).map((cell) => (
              <td key={cell.from}>{inline(cell, scope)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Quote({ node, scope }: { readonly node: SyntaxNode; readonly scope: Scope }) {
  const { source } = scope;
  const parts = childrenOf(node).filter((child) => !MARKS.has(child.name));
  const header = parts[0]?.name === "CalloutHeader" ? parts[0] : null;
  const body = parts.flatMap((child) =>
    child === header || child.name === "CalloutHeader" ? [] : [block(child, scope)],
  );
  if (header === null) return <blockquote>{body}</blockquote>;
  const mark = header.getChild("CalloutMark");
  const type = /\[!([\w-]+)\]/.exec(source.slice(header.from, header.to))?.[1]?.toLowerCase();
  const title = source.slice(mark?.to ?? header.from, header.to).trim();
  return (
    <div className="cv-callout" data-callout={type}>
      <p className="cv-callout-title">{title || type}</p>
      {body}
    </div>
  );
}

function fencedCode(node: SyntaxNode, scope: Scope): ReactNode {
  const { source, host } = scope;
  const info = node.getChild("CodeInfo");
  const code = childrenOf(node)
    .filter((child) => child.name === "CodeText")
    .map((child) => source.slice(child.from, child.to))
    .join("\n");
  if (info !== null && source.slice(info.from, info.to).trim() === "mermaid") {
    const diagram = host.renderMermaid?.(code);
    if (diagram !== undefined) return <div key={node.from}>{diagram}</div>;
  }
  return <pre key={node.from}>{code}</pre>;
}

function block(node: SyntaxNode, scope: Scope): ReactNode {
  const { source } = scope;
  const key = node.from;
  const blocks = () =>
    childrenOf(node)
      .filter((child) => !MARKS.has(child.name))
      .map((child) => block(child, scope));
  const text = () => inline(node, scope);
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
  if (heading) {
    return (
      <p key={key} className="cv-md-heading" data-level={heading[1]}>
        {text()}
      </p>
    );
  }
  switch (node.name) {
    case "Paragraph":
      // An embed can draw a block, which a `<p>` can't hold.
      return node.getChild("Embed") === null ? (
        <p key={key}>{text()}</p>
      ) : (
        <div key={key} className="cv-md-paragraph">
          {text()}
        </div>
      );
    case "BulletList":
      return <ul key={key}>{blocks()}</ul>;
    case "OrderedList":
      return <ol key={key}>{blocks()}</ol>;
    case "ListItem":
      return <li key={key}>{blocks()}</li>;
    case "Task":
    case "ObsidianTask": {
      const marker = node.getChild("TaskMarker");
      const done = marker !== null && /x/i.test(source.slice(marker.from, marker.to));
      return (
        <p key={key}>
          <input type="checkbox" checked={done} readOnly disabled aria-label="Task" /> {text()}
        </p>
      );
    }
    case "Blockquote":
      return <Quote key={key} node={node} scope={scope} />;
    case "FencedCode":
    case "CodeBlock":
      return fencedCode(node, scope);
    case "Table":
      return <Table key={key} node={node} scope={scope} />;
    case "MathBlock": {
      const [open, close] = node.getChildren("MathBlockMark");
      const tex = source.slice(open?.to ?? node.from, close?.from ?? node.to).trim();
      return (
        <div key={key} className="cv-md-math">
          <MathSpan tex={tex} display />
        </div>
      );
    }
    case "HorizontalRule":
      return <hr key={key} />;
    case "CommentBlock":
    case "Frontmatter":
    case "FootnoteDefinition":
      return null;
    default:
      return <pre key={key}>{source.slice(node.from, node.to)}</pre>;
  }
}

const NO_HOST: CanvasMarkdownHost = {};

export const CanvasMarkdown = memo(function CanvasMarkdown({
  text,
  host = NO_HOST,
}: {
  readonly text: string;
  readonly host?: CanvasMarkdownHost | undefined;
}) {
  const root = markdownParser.parse(text).topNode;
  const scope = { source: text, host };
  return <>{childrenOf(root).map((node) => block(node, scope))}</>;
});
