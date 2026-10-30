import type { EditorView } from "@codemirror/view";
import { outlinePath, revealOutlineItem, type OutlineItem } from "@mercurian/editor/outline";
import { ChevronRightIcon } from "lucide-react";

import { Button } from "../ui/button";

/** The items around a file editor's cursor, as `outline()` last reported them. */
export interface OutlineTrail {
  readonly path: readonly OutlineItem[];
  readonly view: EditorView;
}

/**
 * Astrolabe: a repository file's path, then the outline items around the cursor
 * (`file › Class › method`). Clicking an item puts the cursor on its name.
 */
export function FileBreadcrumbs(props: {
  readonly path: string;
  readonly trail: OutlineTrail | null;
}) {
  const { trail } = props;
  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      <span className="min-w-0 shrink truncate font-mono">{props.path}</span>
      {trail?.path.map((item, index) => (
        <span className="flex min-w-0 shrink-[2] items-center gap-0.5" key={item.nameFrom}>
          <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
          <Button
            variant="ghost-muted"
            size="micro"
            title={item.name}
            onClick={() => {
              // The reported positions may have moved since; read the path as it is now.
              const now = outlinePath(trail.view.state)[index];
              if (now) revealOutlineItem(trail.view, now);
            }}
          >
            <span className="truncate">{item.name}</span>
          </Button>
        </span>
      ))}
    </nav>
  );
}
