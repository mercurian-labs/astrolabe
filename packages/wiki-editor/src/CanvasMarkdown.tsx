import { markdownParser } from "@mercurian/editor/markdown/syntax";
import { memo, type ReactNode } from "react";

import { isOpenableUrl } from "./canvasGeometry";

/**
 * A card's Markdown as plain elements. A board can hold hundreds of cards and an editor per card
 * is too heavy, so cards read through the editor's parser with no editor. Syntax with no case
 * here shows as its source text.
 */

type SyntaxNode = ReturnType<typeof markdownParser.parse>["topNode"];

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
]);

const childrenOf = (node: SyntaxNode): SyntaxNode[] => {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    children.push(child);
  }
  return children;
};

function Link({
  href,
  onOpenUrl,
  children,
}: {
  readonly href: string;
  readonly onOpenUrl: ((href: string) => void) | undefined;
  readonly children: ReactNode;
}) {
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

function inline(
  node: SyntaxNode,
  source: string,
  onOpenUrl: ((href: string) => void) | undefined,
): ReactNode[] {
  const output: ReactNode[] = [];
  let at = node.from;
  for (const child of childrenOf(node)) {
    if (child.from > at) output.push(source.slice(at, child.from));
    at = child.to;
    if (child.name === "HeaderMark") while (source[at] === " ") at++;
    if (MARKS.has(child.name) || child.name === "URL" || child.name === "LinkLabel") continue;
    const key = child.from;
    const inner = () => inline(child, source, onOpenUrl);
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
          <Link key={key} href={href} onOpenUrl={onOpenUrl}>
            {child.name === "Autolink" ? href : inner()}
          </Link>,
        );
        break;
      }
      case "WikiLink": {
        const target = source.slice(child.from + 2, child.to - 2);
        output.push(<span key={key}>{target.split("|").at(-1)}</span>);
        break;
      }
      case "HardBreak":
        output.push(<br key={key} />);
        break;
      default:
        output.push(child.firstChild === null ? source.slice(child.from, child.to) : inner());
    }
  }
  if (node.to > at) output.push(source.slice(at, node.to));
  return output;
}

function block(
  node: SyntaxNode,
  source: string,
  onOpenUrl: ((href: string) => void) | undefined,
): ReactNode {
  const key = node.from;
  const blocks = () =>
    childrenOf(node)
      .filter((child) => !MARKS.has(child.name))
      .map((child) => block(child, source, onOpenUrl));
  const text = () => inline(node, source, onOpenUrl);
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
      return <p key={key}>{text()}</p>;
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
      return <blockquote key={key}>{blocks()}</blockquote>;
    case "FencedCode":
    case "CodeBlock": {
      const code = childrenOf(node).filter((child) => child.name === "CodeText");
      return (
        <pre key={key}>{code.map((child) => source.slice(child.from, child.to)).join("\n")}</pre>
      );
    }
    case "HorizontalRule":
      return <hr key={key} />;
    case "CommentBlock":
    case "Frontmatter":
      return null;
    default:
      return <pre key={key}>{source.slice(node.from, node.to)}</pre>;
  }
}

export const CanvasMarkdown = memo(function CanvasMarkdown({
  text,
  onOpenUrl,
}: {
  readonly text: string;
  readonly onOpenUrl: ((href: string) => void) | undefined;
}) {
  const root = markdownParser.parse(text).topNode;
  return <>{childrenOf(root).map((node) => block(node, text, onOpenUrl))}</>;
});
