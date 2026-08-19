import { sanitizeBranchFragment } from "@t3tools/shared/git";

export const CODING_SESSION_BRANCH_PREFIX = "mercurian";
const MAX_TITLE_FRAGMENT = 52;

export function buildCodingSessionBranchName(planTitle: string, randomHex: string): string {
  const token = randomHex
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8)
    .padEnd(8, "0");
  const slug =
    sanitizeBranchFragment(planTitle)
      .replace(/\//gu, "-")
      .replace(/-+/gu, "-")
      .slice(0, MAX_TITLE_FRAGMENT)
      .replace(/-+$/u, "") || "session";
  return `${CODING_SESSION_BRANCH_PREFIX}/${slug}-${token}`;
}
