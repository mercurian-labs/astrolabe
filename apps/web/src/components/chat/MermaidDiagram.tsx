import { diagramImageUrl, useMermaidDiagram } from "@mercurian/wiki-editor/mermaid";

import { serializeCodeBlockToMarkdown } from "../../markdown-clipboard";
import { Button } from "../ui/button";

export function MermaidDiagram({
  source,
  onExpand,
}: {
  source: string;
  onExpand: (imageUrl: string) => void;
}) {
  const diagram = useMermaidDiagram(source);

  if (diagram.status === "failed") {
    return (
      <DiagramError
        message="The diagram renderer failed to load."
        source={source}
        onRetry={diagram.retry}
      />
    );
  }

  const { error, mount } = diagram;
  return (
    <div
      className="chat-markdown-mermaid overflow-x-auto"
      data-markdown-mermaid=""
      data-markdown-copy={serializeCodeBlockToMarkdown(source, "mermaid")}
    >
      {error ? <DiagramError message={error} source={source} /> : null}
      <button
        type="button"
        aria-label="Expand diagram"
        hidden={error !== null}
        className="block w-full cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        onClick={(event) => {
          const svg = event.currentTarget.querySelector("svg");
          if (svg) onExpand(diagramImageUrl(svg));
        }}
      >
        <span ref={mount} className="flex w-full justify-center" />
      </button>
    </div>
  );
}

function DiagramError({
  message,
  source,
  onRetry,
}: {
  message: string;
  source: string;
  onRetry?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-xs text-destructive">Unable to render diagram: {message}</p>
        {onRetry ? (
          <Button type="button" variant="ghost" size="xs" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
      <pre
        data-thread-find-ignore
        className="mt-2 mb-0 overflow-auto font-mono text-xs whitespace-pre-wrap"
      >
        {source}
      </pre>
    </div>
  );
}
