import { memo, Suspense } from "react";

import { isRefusedMermaid, useMermaidDiagram } from "./mermaid";

const Source = ({ source }: { readonly source: string }) => (
  <pre className="mermaid-source">{source}</pre>
);

// `mount` is a new ref each render, which would redraw the diagram: only its source may do that.
const Diagram = memo(function Diagram({ source }: { readonly source: string }) {
  const diagram = useMermaidDiagram(source);
  if (diagram.status === "failed") return <Source source={source} />;
  const { error, mount } = diagram;
  return error === null ? <div ref={mount} /> : <Source source={source} />;
});

/** A Mermaid diagram on the phone: its source until its type has loaded, or if it can't draw. */
export function MobileMermaid({ source }: { readonly source: string }) {
  if (isRefusedMermaid(source)) return <Source source={source} />;
  return (
    <Suspense fallback={<Source source={source} />}>
      <Diagram source={source} />
    </Suspense>
  );
}
