import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/utils";

/** The plan artifact shown in the thread's read-only surface. */
export function PlanArtifact({
  planText,
  readOnlyAction,
}: {
  readonly planText: string;
  readonly readOnlyAction?: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {readOnlyAction === undefined ? null : (
        <div className="flex justify-end px-3 py-1.5 sm:px-4">{readOnlyAction}</div>
      )}
      <PlanArtifactBody planText={planText} />
    </section>
  );
}

/**
 * The plan reads as the markdown document the team already writes plans as.
 *
 * Deliberately not `ChatMarkdown`: that renderer is entangled with the thread
 * surface — scoped thread refs, the right panel, workspace file links — and
 * mounting it here would drag that machinery into the artifact.
 */
export function PlanArtifactBody({ planText }: { readonly planText: string }) {
  if (planText.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-4">
        <p className="text-sm text-muted-foreground/70">No plan yet.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-3 py-4 text-sm text-foreground sm:px-4",
        "[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold first:[&_h1]:mt-0",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold first:[&_h2]:mt-0",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium",
        "[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/60 [&_pre]:p-3",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
      )}
    >
      <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
        {planText}
      </ReactMarkdown>
    </div>
  );
}
