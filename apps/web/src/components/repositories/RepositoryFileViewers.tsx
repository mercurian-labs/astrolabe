import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import type { EnvironmentId } from "@t3tools/contracts";
import { filePreviewDelimiter } from "@t3tools/shared/delimitedPreview";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { CheckIcon, CopyIcon, DownloadIcon, GitBranchIcon } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { TabHeader } from "~/panes/TabHeader";
import { toastManager } from "../ui/toast";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { AudioPreview } from "../files/AudioPreview";
import { BrowserDocumentFrame } from "../files/BrowserDocumentFrame";
import { DelimitedTablePreview } from "../files/DelimitedTablePreview";
import {
  FILE_SURFACE_SUBHEADER_CLASS,
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
} from "../files/fileSurfaceChrome";
import { MermaidFilePreview } from "../files/MermaidFilePreview";
import { PreviewImage } from "../files/PreviewImage";
import { MediaActions } from "../media/MediaActions";
import { MediaVideoPlayer } from "../media/MediaVideoPlayer";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import { fileAssetResource, type FileView, type RenderedForm } from "./fileView";
import { FileOpenIn } from "./RepositoryFileHeader";
import type { CheckedOutRepositoryTab } from "./repositoryTabs";

type FileTab = Extract<CheckedOutRepositoryTab, { kind: "file" }>;

interface FileTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
}

/** A file that is not text, in the thread file panel's viewer for its type. */
export default function RepositoryFileViewer(props: {
  readonly tab: FileTab;
  readonly kind: Exclude<FileView["kind"], "text">;
}) {
  const { tab } = props;
  return (
    <div className="@container/file flex min-h-0 flex-1 flex-col">
      <TabHeader.Root>
        <FileBreadcrumbs path={tab.path} trail={null} />
        <TabHeader.Status className="font-mono @max-[36rem]/file:hidden">
          <GitBranchIcon className="size-3.5" />
          {tab.checkoutName}
        </TabHeader.Status>
        <TabHeader.Actions>
          <FileOpenIn environmentId={tab.environmentId} cwd={tab.cwd} path={tab.path} />
        </TabHeader.Actions>
      </TabHeader.Root>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Viewer target={tab} kind={props.kind} />
      </div>
    </div>
  );
}

function Viewer({
  target,
  kind,
}: {
  readonly target: FileTarget;
  readonly kind: Exclude<FileView["kind"], "text">;
}) {
  switch (kind) {
    case "image":
      return <ImageViewer target={target} />;
    case "video":
      return <VideoViewer target={target} />;
    case "audio":
      return <AudioViewer target={target} />;
    case "pdf":
      return <BrowserViewer target={target} pdf />;
    case "document":
      return <DocumentViewer target={target} use="show" />;
  }
}

/** A text file's rendered form, from the text the editor holds. */
export function RenderedFileView(props: {
  readonly target: FileTarget;
  readonly form: RenderedForm;
  readonly contents: string;
}) {
  const { target, contents } = props;
  switch (props.form) {
    case "table":
      return (
        <DelimitedTablePreview
          name={target.path}
          text={contents}
          delimiter={filePreviewDelimiter({ name: target.path }) ?? ","}
        />
      );
    case "mermaid":
      return <MermaidFilePreview text={contents} />;
    case "html":
      return <BrowserViewer target={target} pdf={false} />;
  }
}

/**
 * A file read whole as bytes: too big for a document (the large text viewer pages it in a
 * worker), or not text at all (the binary viewer, with a download).
 */
export function WholeFileView(props: {
  readonly target: FileTarget;
  readonly whole: "large" | "binary";
  readonly reveal: { readonly line: number; readonly id: number } | null;
  readonly wordWrap: boolean;
}) {
  if (props.whole === "binary") {
    return <DocumentViewer target={props.target} use="download" />;
  }
  return <LargeFileViewer {...props} />;
}

function DocumentViewer({
  target,
  use,
}: {
  readonly target: FileTarget;
  readonly use: "show" | "download";
}) {
  const resource = fileAssetResource(target, use);
  return (
    <AttachmentFilePreview
      name={target.path.split(/[\\/]/).at(-1) || target.path}
      mimeType="application/octet-stream"
      sizeBytes={0}
      asset={{ environmentId: target.environmentId, resource }}
      origin="File"
    />
  );
}

const LargeTextViewer = lazy(() => import("../files/LargeTextViewer"));

function LargeFileViewer(props: {
  readonly target: FileTarget;
  readonly reveal: { readonly line: number; readonly id: number } | null;
  readonly wordWrap: boolean;
}) {
  const { target } = props;
  const resource = fileAssetResource(target, "download");
  const assetUrl = useAssetUrlState(target.environmentId, resource);
  const refresh = useAssetUrlRefresh(target.environmentId, resource);
  const copyContents = useRef<(() => Promise<string>) | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: target.path });
  const [saving, setSaving] = useState(false);
  const [retries, setRetries] = useState(0);
  const showError = (cause: unknown) =>
    toastManager.add({
      type: "error",
      title: "Could not read file",
      description: cause instanceof Error ? cause.message : "Try again.",
    });
  if (assetUrl._tag === "Failure") {
    return (
      <FileSurfaceFailure
        message="Unable to load file preview."
        onRetry={() => void refresh().catch(showError)}
      />
    );
  }
  if (assetUrl._tag !== "Success") return <FileSurfaceLoading />;
  const name = target.path.split(/[\\/]/).at(-1) || target.path;
  const save = async () => {
    const url = await refresh();
    if (!url) throw new Error("Reconnect to the environment and try again.");
    const response = await fetch(url);
    if (!response.ok) throw new Error("The file could not be loaded. Try again.");
    const download = URL.createObjectURL(await response.blob());
    setTimeout(() => URL.revokeObjectURL(download), 30_000);
    const anchor = document.createElement("a");
    anchor.href = download;
    anchor.download = name;
    anchor.click();
  };
  return (
    <>
      <div className={FILE_SURFACE_SUBHEADER_CLASS}>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          Too big to edit here: the whole file, read only
        </span>
        <FileSurfaceAction
          label={isCopied ? "Copied" : "Copy contents"}
          onPress={() => {
            void copyContents
              .current?.()
              .then((text) => copyToClipboard(text, undefined))
              .catch(showError);
          }}
        >
          {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </FileSurfaceAction>
        <FileSurfaceAction
          label={saving ? "Preparing file…" : "Save file"}
          disabled={saving}
          onPress={() => {
            setSaving(true);
            void save()
              .catch(showError)
              .finally(() => setSaving(false));
          }}
        >
          <DownloadIcon className="size-3.5" />
        </FileSurfaceAction>
      </div>
      <Suspense fallback={<FileSurfaceLoading />}>
        <LargeTextViewer
          key={`${assetUrl.url}:${retries}`}
          name={target.path}
          copyContents={copyContents}
          onRetry={() => {
            void refresh()
              .then(() => setRetries((value) => value + 1))
              .catch(showError);
          }}
          src={assetUrl.url}
          delimiter={null}
          revealLine={props.reveal?.line ?? null}
          revealRequestId={props.reveal?.id ?? 0}
          wordWrap={props.wordWrap}
        />
      </Suspense>
    </>
  );
}

function mediaSource(target: FileTarget, kind: "image" | "video", src: string | null) {
  return {
    kind,
    name: target.path,
    src,
    reference: mediaFileReference(resolvePathLinkTarget(target.path, target.cwd), target.cwd),
    asset: { environmentId: target.environmentId, resource: fileAssetResource(target, "show") },
  };
}

function ImageViewer({ target }: { readonly target: FileTarget }) {
  const assetUrl = useAssetUrlState(target.environmentId, fileAssetResource(target, "show"));
  const src = assetUrl._tag === "Success" ? assetUrl.url : null;
  if (assetUrl._tag === "Failure") return <FileSurfaceFailure message="Unable to load image." />;
  if (src === null) return <FileSurfaceLoading />;
  return (
    <MediaActions source={mediaSource(target, "image", src)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PreviewImage key={src} src={src} name={target.path} />
      </div>
    </MediaActions>
  );
}

function VideoViewer({ target }: { readonly target: FileTarget }) {
  const resource = fileAssetResource(target, "show");
  const assetUrl = useAssetUrlState(target.environmentId, resource);
  const refresh = useAssetUrlRefresh(target.environmentId, resource);
  const src = assetUrl._tag === "Success" ? assetUrl.url : null;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
      <MediaVideoPlayer
        src={src}
        sourceFailed={assetUrl._tag === "Failure"}
        label={target.path}
        revision={assetUrl._tag === "Success" ? (assetUrl.fileRevision ?? null) : null}
        preload="metadata"
        className="flex h-full min-h-0 w-full max-w-5xl items-center justify-center"
        videoClassName="aspect-auto max-h-full w-auto max-w-full"
        onRetry={refresh}
        actionsSource={mediaSource(target, "video", src)}
      />
    </div>
  );
}

function AudioViewer({ target }: { readonly target: FileTarget }) {
  const resource = fileAssetResource(target, "show");
  const assetUrl = useAssetUrlState(target.environmentId, resource);
  const refresh = useAssetUrlRefresh(target.environmentId, resource);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = assetUrl._tag === "Success" ? assetUrl.url : null;
  if (assetUrl._tag === "Failure" || (src !== null && failedUrl === src)) {
    return (
      <FileSurfaceFailure
        message="Unable to load audio."
        onRetry={() => {
          setFailedUrl(null);
          void refresh().catch(() => undefined);
        }}
      />
    );
  }
  if (src === null) return <FileSurfaceLoading />;
  return (
    <AudioPreview
      src={src}
      name={target.path}
      revision={assetUrl._tag === "Success" ? (assetUrl.fileRevision ?? null) : null}
      onError={() => setFailedUrl(src)}
    />
  );
}

function BrowserViewer({ target, pdf }: { readonly target: FileTarget; readonly pdf: boolean }) {
  const assetUrl = useAssetUrlState(target.environmentId, fileAssetResource(target, "show"));
  if (assetUrl._tag === "Failure") {
    return <FileSurfaceFailure message="Unable to load file preview." />;
  }
  if (assetUrl._tag !== "Success") return <FileSurfaceLoading />;
  return (
    <BrowserDocumentFrame
      src={assetUrl.url}
      documentId={pdf ? `${target.environmentId}:${target.cwd}:${target.path}` : undefined}
      title={target.path}
      pdf={pdf}
    />
  );
}
