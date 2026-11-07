import { isRefusedMermaid } from "@mercurian/wiki-editor/mermaid";
import { Suspense, useState } from "react";

import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { MermaidDiagram } from "../chat/MermaidDiagram";

function DiagramSource({ source }: { readonly source: string }) {
  return (
    <pre className="m-0 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
      {source}
    </pre>
  );
}

/** A Mermaid diagram in a wiki's note or card, which comes from a file and is treated as one. */
export function WikiMermaid({ source }: { readonly source: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (isRefusedMermaid(source)) return <DiagramSource source={source} />;
  return (
    <Suspense fallback={<DiagramSource source={source} />}>
      <MermaidDiagram source={source} onExpand={setExpanded} />
      {expanded ? (
        <ExpandedImageDialog
          preview={{ images: [{ src: expanded, name: "Mermaid diagram" }], index: 0 }}
          onClose={() => setExpanded(null)}
        />
      ) : null}
    </Suspense>
  );
}
