import type { WaitlistDecision, WaitlistEntry } from "@mercurian/cloud/waitlist";

/** Server-rendered pages: no client script, so the CSP can forbid all of it. */
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const METHOD_LABELS: Record<string, string> = {
  credential: "password",
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
};

const methodsLabel = (methods: ReadonlyArray<string>) =>
  methods.length === 0
    ? "email code"
    : methods.map((method) => METHOD_LABELS[method] ?? method).join(", ");

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const formatDate = (date: Date) => `${dateFormatter.format(date)} UTC`;

// Astrolabe's Mercurian palette (packages/shared/src/mercurianTheme.ts), light only.
const STYLE = `
  :root { color-scheme: light; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  body { margin: 0; background: oklch(0.976 0 0); color: oklch(0 0 0); }
  main { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 15px; margin: 32px 0 12px; }
  .muted { color: oklch(0.51 0 0); }
  .notice { background: oklch(0.955 0 0); border: 1px solid oklch(0.898 0 0); border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; }
  form.search { display: flex; gap: 8px; margin-bottom: 16px; }
  input[type=search] { flex: 1; height: 34px; padding: 0 10px; border: 1px solid oklch(0.845 0 0); border-radius: 8px; background: #fff; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid oklch(0.898 0 0); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-top: 1px solid oklch(0.898 0 0); vertical-align: middle; }
  th { border-top: 0; font-weight: 500; color: oklch(0.51 0 0); background: oklch(0.955 0 0); }
  td.actions { white-space: nowrap; text-align: right; }
  button { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid oklch(0.845 0 0); background: #fff; font: inherit; cursor: pointer; }
  button.primary { background: oklch(0.274 0.006 78.2); border-color: oklch(0.274 0.006 78.2); color: #fff; }
  button.danger { color: oklch(0.504 0.152 27); }
  .bulk { display: flex; gap: 8px; margin-top: 12px; }
  .empty { padding: 24px; text-align: center; }
`;

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

export function renderWaitlist(input: {
  readonly operator: string | null;
  readonly search: string;
  readonly pending: ReadonlyArray<WaitlistEntry>;
  readonly recent: ReadonlyArray<WaitlistDecision>;
  readonly notice: string | null;
}): string {
  const rows = input.pending
    .map(
      (entry) => `<tr>
        <td><input type="checkbox" name="email" value="${escapeHtml(entry.email)}" aria-label="Select ${escapeHtml(entry.email)}"></td>
        <td>${escapeHtml(entry.email)}<div class="muted">${escapeHtml(entry.name || "No name")}${entry.wantsOrganization ? " · member asking for their own organization" : ""}</div></td>
        <td>${escapeHtml(methodsLabel(entry.methods))}</td>
        <td>${escapeHtml(formatDate(entry.joinedAt))}</td>
        <td class="actions">
          <button class="primary" name="one" value="approve ${escapeHtml(entry.email)}">Approve</button>
          <button class="danger" name="one" value="decline ${escapeHtml(entry.email)}">Decline</button>
        </td>
      </tr>`,
    )
    .join("");
  const pendingTable =
    input.pending.length === 0
      ? `<p class="notice empty muted">${input.search ? "Nobody on the waitlist matches." : "Nobody is waiting."}</p>`
      : `<form method="post" action="/decide">
          <table>
            <thead><tr><th></th><th>Account</th><th>Signs in with</th><th>Joined</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="bulk">
            <button class="primary" name="action" value="approve">Approve selected</button>
            <button class="danger" name="action" value="decline">Decline selected</button>
          </div>
        </form>`;

  const recentRows = input.recent
    .map(
      (decision) => `<tr>
        <td>${escapeHtml(decision.email)}<div class="muted">${escapeHtml(decision.name || "No name")}</div></td>
        <td>${decision.access === "approved" ? "Approved" : "Declined"}</td>
        <td>${escapeHtml(formatDate(decision.decidedAt))}</td>
        <td class="actions">${
          decision.canUndo
            ? `<button name="one" value="undo ${escapeHtml(decision.email)}">Back to waitlist</button>`
            : `<span class="muted">In an organization</span>`
        }</td>
      </tr>`,
    )
    .join("");
  const recentTable =
    input.recent.length === 0
      ? `<p class="muted">No decisions in the last 30 days.</p>`
      : `<form method="post" action="/decide"><table>
          <thead><tr><th>Account</th><th>Decision</th><th>When</th><th></th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table></form>`;

  return layout(
    "Waitlist · Mercurian admin",
    `<header>
      <h1>Waitlist <span class="muted">· ${input.pending.length} waiting</span></h1>
      <span class="muted">${input.operator ? `Signed in as ${escapeHtml(input.operator)}` : "Local development"}</span>
    </header>
    ${input.notice ? `<p class="notice" role="status">${escapeHtml(input.notice)}</p>` : ""}
    <form class="search" method="get" action="/">
      <input type="search" name="q" value="${escapeHtml(input.search)}" placeholder="Search by email or name" aria-label="Search">
      <button>Search</button>
    </form>
    ${pendingTable}
    <h2>Last 30 days</h2>
    ${recentTable}`,
  );
}

export function renderForbidden(reason: string): string {
  return layout(
    "Not allowed · Mercurian admin",
    `<h1>Not allowed</h1><p class="muted">${escapeHtml(reason)}</p>`,
  );
}
