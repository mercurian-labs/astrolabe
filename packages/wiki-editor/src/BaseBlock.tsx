import { useSyncExternalStore } from "react";

import { rowDocument } from "./baseCells";
import { BaseLayout, type BaseLayoutHost } from "./baseLayout";
import type { WikiEditorPage } from "./mobilePageController";

/**
 * A base's view on the phone, a ```base block's or a `.base` file's: the app runs it and keeps
 * the page's copy current. One view, the one the app picked (a block's first); each row's name
 * opens its note. A map view lists its places, and repository images show as blanks.
 */
export function BaseBlock({
  page,
  source,
  onOpenNote,
  onOpenUrl,
}: {
  readonly page: WikiEditorPage;
  readonly source: string;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenUrl?: (href: string) => void;
}) {
  const base = useSyncExternalStore(
    (listener) => page.watchBase(source, listener),
    () => page.getBase(source),
  );
  const host: BaseLayoutHost = {
    canOpenRow: (row) => rowDocument(row) !== null,
    openRow: (row) => {
      const document = rowDocument(row);
      if (document !== null) onOpenNote(document);
    },
    openLink: onOpenNote,
    ...(onOpenUrl ? { openUrl: onOpenUrl } : {}),
  };
  return (
    <div className="base-view">
      {base?.result ? (
        <BaseLayout result={base.result} host={host} />
      ) : base?.error ? (
        <p className="base-error">{base.error}</p>
      ) : (
        <p className="bl-muted">Loading the base…</p>
      )}
    </div>
  );
}
