import type { PlanOrigin, PlanSpecAt, SpecDocument } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/utils";

/** The spec artifact shown in the thread's read-only surface. */
export function SpecArtifact({
  spec,
  origin,
  readOnlyAction,
}: {
  readonly spec: PlanSpecAt | null;
  readonly origin?: PlanOrigin;
  readonly readOnlyAction?: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {readOnlyAction === undefined ? null : (
        <div className="flex justify-end px-3 py-1.5 sm:px-4">{readOnlyAction}</div>
      )}
      {origin === undefined ? null : (
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground sm:px-4">
          <span>From issue {origin.issueId}</span>
          <a
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
            href={origin.issueUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open issue <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      )}
      <SpecBody document={spec?.document ?? null} />
    </section>
  );
}

function SpecBody({ document }: { readonly document: SpecDocument | null }) {
  if (document === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-4">
        <p className="text-sm text-muted-foreground/70">No spec yet.</p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
      <h2 className="text-xs font-medium text-muted-foreground">Goal / user story</h2>
      <SpecMarkdown className="mt-2" text={document.goal} />
      <h2 className="mt-6 text-xs font-medium text-muted-foreground">Acceptance criteria</h2>
      <SpecMarkdown className="mt-2" text={document.acceptanceCriteria} />
    </div>
  );
}

function SpecMarkdown({ className, text }: { readonly className?: string; readonly text: string }) {
  return (
    <div
      className={cn(
        "text-sm text-foreground",
        "[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold first:[&_h1]:mt-0",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-semibold [&_li]:my-0.5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    >
      <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
