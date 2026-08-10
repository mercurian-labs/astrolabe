/**
 * Path inference for the add flow's folder and clone paths.
 *
 * Hosting-provider readiness is shared by every provider surface in
 * `hostingProviders.logic.ts`; this module only owns destination and name
 * inference used by the dialog.
 */
import { ensureBrowseDirectoryPath, inferProjectTitleFromPath } from "../../lib/projectPaths";

/**
 * The last segment of a clone URL, without its `.git` suffix — what the clone
 * will be called on disk, and so what the destination should end with.
 */
export function inferRepositoryNameFromUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return "";
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const lastSegment = withoutQuery.split(/[/:]/).findLast((segment) => segment.length > 0) ?? "";
  return lastSegment.replace(/\.git$/i, "");
}

/**
 * Where a clone lands: the base directory a person configured, plus the name
 * the source implies. Empty when there is nothing to infer, so the dialog can
 * ask rather than guess.
 */
export function deriveCloneDestination(baseDirectory: string, source: string): string {
  const name = inferRepositoryNameFromUrl(source);
  if (name.length === 0) return "";
  const base = baseDirectory.trim();
  if (base.length === 0) return `~/${name}`;
  return `${ensureBrowseDirectoryPath(base)}${name}`;
}

/** The name a picked folder implies, which the add dialog offers as a default. */
export function inferRepositoryNameFromPath(path: string): string {
  return inferProjectTitleFromPath(path);
}
