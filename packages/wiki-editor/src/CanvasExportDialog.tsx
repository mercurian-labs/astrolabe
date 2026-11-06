import type { CanvasData } from "@mercurian/wiki/canvas";
import { useRef, useState } from "react";

import {
  canvasExportArea,
  canvasExportSize,
  drawCanvasExport,
  loadExportImages,
  type CanvasExportColors,
} from "./canvasExport";
import type { CanvasView } from "./canvasView";

function themeColors(element: Element): CanvasExportColors {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--background", "#ffffff"),
    foreground: read("--foreground", "#1c1c1e"),
    muted: read("--muted-foreground", "#6b6b70"),
    border: read("--border", "#e3e3e6"),
    line: read("--muted-foreground", "#6b6b70"),
  };
}

/** Export as image: what it covers, how large, and whether it says what it says. */
export function CanvasExportDialog({
  data,
  view,
  name,
  assetUrl,
  onClose,
}: {
  readonly data: CanvasData;
  readonly view: CanvasView;
  readonly name: string;
  readonly assetUrl: ((path: string) => Promise<string | null>) | undefined;
  readonly onClose: () => void;
}) {
  const [area, setArea] = useState<"full" | "viewport">("full");
  const [zoom, setZoom] = useState(0);
  const [showLogo, setShowLogo] = useState(true);
  const [privacy, setPrivacy] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  const empty = data.nodes.length === 0;
  const bounds = canvasExportArea(data, view.window(), { area });
  const { width, height } = canvasExportSize(bounds, zoom);

  const save = async () => {
    setSaving(true);
    const canvas = document.createElement("canvas");
    const images = await loadExportImages(data, assetUrl);
    drawCanvasExport(
      canvas,
      data,
      bounds,
      { area, zoom, showLogo, privacy },
      themeColors(dialog.current ?? document.documentElement),
      images,
    );
    canvas.toBlob((blob) => {
      setSaving(false);
      if (blob === null) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.png`;
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    }, "image/png");
  };

  return (
    <form
      ref={dialog}
      className="cv-chrome cv-dialog cv-export"
      role="dialog"
      aria-label="Export as image"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
    >
      <label>
        <span>Viewport</span>
        <select
          autoFocus
          value={area}
          onChange={(event) => setArea(event.target.value === "viewport" ? "viewport" : "full")}
        >
          <option value="full">Full canvas</option>
          <option value="viewport">Viewport only</option>
        </select>
      </label>
      <label>
        <span>Zoom {(2 ** zoom).toFixed(2)}</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.25}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
      </label>
      <p className="cv-muted">
        Estimated image dimensions: {width} × {height}
      </p>
      <label className="cv-check">
        <input
          type="checkbox"
          checked={showLogo}
          onChange={(event) => setShowLogo(event.target.checked)}
        />
        <span>Show logo</span>
      </label>
      <label className="cv-check">
        <input
          type="checkbox"
          checked={privacy}
          onChange={(event) => setPrivacy(event.target.checked)}
        />
        <span>Privacy mode: obscures all text</span>
      </label>
      <div className="cv-dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={empty || saving}>
          Save
        </button>
      </div>
    </form>
  );
}
