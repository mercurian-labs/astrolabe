import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { filePreviewDelimiter } from "@t3tools/shared/delimitedPreview";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { TabHeader } from "~/panes/TabHeader";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { AudioPreview } from "../files/AudioPreview";
import { BrowserDocumentFrame } from "../files/BrowserDocumentFrame";
import { DelimitedTablePreview } from "../files/DelimitedTablePreview";
import { FileSurfaceFailure, FileSurfaceLoading } from "../files/fileSurfaceChrome";
import { MermaidFilePreview } from "../files/MermaidFilePreview";
import { PreviewImage } from "../files/PreviewImage";
import { MediaActions } from "../media/MediaActions";
import { MediaVideoPlayer } from "../media/MediaVideoPlayer";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import type { FileView, RenderedForm } from "./fileView";
import { FileOpenIn } from "./RepositoryFileHeader";
import type { CheckedOutRepositoryTab } from "./repositoryTabs";

type FileTab = Extract<CheckedOutRepositoryTab, { kind: "file" }>;

interface FileTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
}

// No thread owns a Projects or wiki tab; the server signs this one for any folder on the host.
const fileAsset = (target: FileTarget) =>
  ({
    _tag: "draft-workspace-file",
    cwd: target.cwd,
    path: target.path,
  }) as const satisfies AssetResource;

/** A file that is not text, in the thread file panel's viewer for its type. */
export default function RepositoryFileViewer(props: {
  readonly tab: FileTab;
  readonly kind: Exclude<FileView["kind"], "text">;
}) {
  const { tab } = props;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabHeader.Root>
        <FileBreadcrumbs path={tab.path} trail={null} />
        <TabHeader.Status className="font-mono">
          <GitBranchIcon className="size-3.5" />
          {tab.checkoutName}
        </TabHeader.Status>
        <FileOpenIn environmentId={tab.environmentId} cwd={tab.cwd} path={tab.path} />
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
      return (
        <AttachmentFilePreview
          name={target.path.split("/").at(-1) || target.path}
          mimeType="application/octet-stream"
          sizeBytes={0}
          asset={{ environmentId: target.environmentId, resource: fileAsset(target) }}
          origin="File"
        />
      );
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

function mediaSource(target: FileTarget, kind: "image" | "video", src: string | null) {
  return {
    kind,
    name: target.path,
    src,
    reference: mediaFileReference(resolvePathLinkTarget(target.path, target.cwd), target.cwd),
    asset: { environmentId: target.environmentId, resource: fileAsset(target) },
  };
}

function ImageViewer({ target }: { readonly target: FileTarget }) {
  const assetUrl = useAssetUrlState(target.environmentId, fileAsset(target));
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
  const assetUrl = useAssetUrlState(target.environmentId, fileAsset(target));
  const refresh = useAssetUrlRefresh(target.environmentId, fileAsset(target));
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
  const assetUrl = useAssetUrlState(target.environmentId, fileAsset(target));
  const refresh = useAssetUrlRefresh(target.environmentId, fileAsset(target));
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
  const assetUrl = useAssetUrlState(target.environmentId, fileAsset(target));
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
