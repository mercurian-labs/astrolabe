import type { CodeViewDiffItem } from "@pierre/diffs/react";
import { useMemo } from "react";

import { useTheme } from "../../hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName } from "../../lib/diffRendering";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";

/** Shared memory patch viewer retained for the line-memory list. */
export function MemoryDiffViewer({ patch, id }: { readonly patch: string; readonly id: string }) {
  const { resolvedTheme } = useTheme();
  const renderablePatch = useMemo(() => getRenderablePatch(patch, id), [id, patch]);
  const diffItems = useMemo<ReadonlyArray<CodeViewDiffItem<undefined>>>(
    () =>
      renderablePatch?.kind === "files"
        ? renderablePatch.files.map((fileDiff, index) => ({
            id: fileDiff.cacheKey ?? `${fileDiff.name ?? fileDiff.prevName ?? "file"}:${index}`,
            type: "diff",
            fileDiff,
            annotations: [],
            collapsed: false,
          }))
        : [],
    [renderablePatch],
  );
  if (renderablePatch?.kind === "files") {
    return (
      <div className="h-[24rem] max-h-[45vh] min-h-48 overflow-hidden rounded-lg border border-border">
        <StyledDiffCodeView
          className="h-full overflow-auto"
          items={diffItems}
          options={{ diffStyle: "unified", theme: resolveDiffThemeName(resolvedTheme) }}
        />
      </div>
    );
  }
  if (renderablePatch?.kind === "raw") {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{renderablePatch.reason}</p>
        <pre className="max-h-[45vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
          {renderablePatch.text}
        </pre>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">This memory change has no rendered diff.</p>;
}
