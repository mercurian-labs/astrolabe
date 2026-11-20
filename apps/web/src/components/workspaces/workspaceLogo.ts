import { WORKSPACE_LOGO_MAX_LENGTH } from "@t3tools/shared/mercurianWorkspaces";

// Four times the rail tile, so it stays sharp on high-density screens.
const LOGO_PX = 128;

export const WORKSPACE_LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

/**
 * An image file as a workspace logo: centre-cropped to a square, drawn at 128px and encoded as
 * WebP (PNG where the browser can't), so any format, SVG included, becomes a small raster.
 */
export async function workspaceLogoFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = LOGO_PX;
    canvas.height = LOGO_PX;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't draw images.");
    context.imageSmoothingQuality = "high";
    const { naturalWidth: width, naturalHeight: height } = image;
    const side = Math.min(width, height);
    // An SVG with only a viewBox has no natural size; it's drawn to fill the square.
    if (side === 0) context.drawImage(image, 0, 0, LOGO_PX, LOGO_PX);
    else {
      const [x, y] = [(width - side) / 2, (height - side) / 2];
      context.drawImage(image, x, y, side, side, 0, 0, LOGO_PX, LOGO_PX);
    }
    const logo = canvas.toDataURL("image/webp", 0.9);
    if (logo.length > WORKSPACE_LOGO_MAX_LENGTH) throw new Error("That image is too detailed.");
    return logo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
