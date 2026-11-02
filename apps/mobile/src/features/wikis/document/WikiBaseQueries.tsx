import type { WikiEditorBaseResult } from "@mercurian/wiki-editor/protocol";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { useEffect } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { wikiEnvironment } from "../../../state/wiki";

/** What the editor page is told about one ```base block: its view, or why it can't show. */
export interface WikiBaseAnswer {
  readonly result: WikiEditorBaseResult | null;
  readonly error: string | null;
}

interface Scope {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** The note the blocks sit in, which `this` names inside them. */
  readonly note: string;
  readonly onAnswer: (source: string, answer: WikiBaseAnswer) => void;
}

function WikiBaseQuery({ source, ...scope }: Scope & { readonly source: string }) {
  const { environmentId, wikiId, changeRequestId, note, onAnswer } = scope;
  const { data, error } = useEnvironmentQuery(
    wikiEnvironment.query({
      environmentId,
      input: {
        wikiId,
        ...(changeRequestId === undefined ? {} : { changeRequestId }),
        source,
        note,
      },
    }),
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- each answer crosses into the editor's web view, outside React
  useEffect(() => {
    if (data !== null) onAnswer(source, { result: data, error: null });
    else if (error !== null) onAnswer(source, { result: null, error });
  }, [data, error, source, onAnswer]);
  return null;
}

/**
 * Runs the ```base blocks the editor page shows, one live query each, and hands every answer to
 * `onAnswer`: a block's view follows the wiki as it changes. Renders nothing.
 */
export function WikiBaseQueries({
  sources,
  ...scope
}: Scope & { readonly sources: ReadonlyArray<string> }) {
  return sources.map((source) => <WikiBaseQuery key={source} source={source} {...scope} />);
}
