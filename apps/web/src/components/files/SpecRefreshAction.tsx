import { useState } from "react";
import {
  MercurianRepositoryId,
  type ThreadId,
  type EnvironmentId,
  type RefreshProjectSpecResult,
  type SpecDocument,
} from "@t3tools/contracts";
import { useRefreshProjectSpec } from "../../state/mercurianStorage";
import { Button } from "../ui/button";

type Review = Extract<RefreshProjectSpecResult, { kind: "reconciliation-required" }>;
export function SpecRefreshAction({
  threadId,
  environmentId,
  documentId,
  repositoryId,
  relativePath,
  onSaved,
}: {
  threadId: ThreadId;
  environmentId: EnvironmentId;
  documentId: string;
  repositoryId: string;
  relativePath: string;
  onSaved: () => void;
}) {
  const refresh = useRefreshProjectSpec(environmentId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [resolved, setResolved] = useState<SpecDocument>({ goal: "", acceptanceCriteria: "" });
  async function run(confirm = false) {
    setBusy(true);
    setStatus(null);
    try {
      const result = await refresh({
        threadId,
        documentId,
        repositoryId: MercurianRepositoryId.make(repositoryId),
        relativePath,
        ...(confirm && review
          ? {
              expectedHash: review.expectedHash,
              reviewedUpstream: review.upstream,
              resolvedDocument: resolved,
            }
          : {}),
      });
      if (!result.ok) {
        setStatus(
          "Could not refresh. Check the issue connection and wait for any active turn to finish.",
        );
        return;
      }
      if (result.value.kind === "reconciliation-required") {
        setReview(result.value);
        setResolved(result.value.local);
        return;
      }
      setReview(null);
      setStatus(result.value.kind === "unchanged" ? "Issue is unchanged." : "Spec saved.");
      if (result.value.kind === "saved") onSaved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-b p-3 text-xs space-y-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
        Refresh from issue
      </Button>
      {status && <p role="status">{status}</p>}
      {review && (
        <div className="space-y-2">
          <p>
            Both the spec and issue changed. Review the versions, then choose or edit the result.
          </p>
          {(["base", "local", "upstream"] as const).map((version) => (
            <details key={version}>
              <summary className="cursor-pointer capitalize">
                {version === "base" ? "Previously imported" : version}
              </summary>
              <pre className="whitespace-pre-wrap py-2">
                {review[version].goal}
                {"\n\n"}
                {review[version].acceptanceCriteria}
              </pre>
              {version !== "base" && (
                <Button size="sm" variant="ghost" onClick={() => setResolved(review[version])}>
                  Use {version}
                </Button>
              )}
            </details>
          ))}
          <label className="block">
            Goal
            <textarea
              className="mt-1 block w-full rounded border p-2"
              value={resolved.goal}
              onChange={(event) => setResolved({ ...resolved, goal: event.target.value })}
            />
          </label>
          <label className="block">
            Acceptance criteria
            <textarea
              className="mt-1 block w-full rounded border p-2"
              value={resolved.acceptanceCriteria}
              onChange={(event) =>
                setResolved({ ...resolved, acceptanceCriteria: event.target.value })
              }
            />
          </label>
          <Button size="sm" disabled={busy} onClick={() => void run(true)}>
            Save reviewed spec
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReview(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
