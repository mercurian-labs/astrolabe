import type { Decision, Waitlist } from "@mercurian/cloud/waitlist";

import { renderForbidden, renderWaitlist } from "./page.ts";

/**
 * Who is operating: `tailscale serve` adds this header for the tailnet user
 * behind every request. The server must listen only where `tailscale serve`
 * can reach it (loopback in its container), or anyone could set the header.
 */
const OPERATOR_HEADER = "tailscale-user-login";

const DECISIONS = new Set<Decision>(["approve", "decline", "undo"]);

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  // Not no-referrer: under it browsers send `Origin: null` on form posts,
  // which the cross-site check below would refuse.
  "referrer-policy": "same-origin",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

export interface AdminDeps {
  readonly waitlist: Waitlist;
  /** Sends the "you're in" email. */
  readonly sendApproval: (email: string) => Promise<void>;
  /** Local development only: serve requests that didn't come through `tailscale serve`. */
  readonly allowAnonymous: boolean;
  readonly log: (line: string) => void;
}

const html = (body: string, status = 200) => new Response(body, { status, headers: PAGE_HEADERS });

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The internal admin site, as a web request handler; src/main.ts serves it. */
export function makeAdminHandler(deps: AdminDeps) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const operator = request.headers.get(OPERATOR_HEADER);
    if (!operator && !deps.allowAnonymous) {
      return html(renderForbidden("This page is only available on the Mercurian tailnet."), 403);
    }

    if (request.method === "GET" && url.pathname === "/") {
      const search = url.searchParams.get("q") ?? "";
      const [pending, recent] = await Promise.all([
        deps.waitlist.pending(search),
        deps.waitlist.recent(),
      ]);
      return html(
        renderWaitlist({ operator, search, pending, recent, notice: url.searchParams.get("done") }),
      );
    }

    if (request.method === "POST" && url.pathname === "/decide") {
      // A form on another site could otherwise post here through an operator's browser.
      if (request.headers.get("origin") !== url.origin) {
        return html(renderForbidden("That request didn't come from this page."), 403);
      }
      const form = await request.formData();
      const one = form.get("one");
      const [decision, emails] =
        typeof one === "string"
          ? [one.slice(0, one.indexOf(" ")), [one.slice(one.indexOf(" ") + 1)]]
          : [String(form.get("action")), form.getAll("email").map(String)];
      if (!DECISIONS.has(decision as Decision))
        return html(renderForbidden("Unknown action."), 400);

      const changed = await deps.waitlist.decide(decision as Decision, emails);
      deps.log(`${operator ?? "local"} ${decision} ${changed.join(", ") || "(nothing changed)"}`);
      let unsent = 0;
      if (decision === "approve") {
        for (const email of changed) {
          await deps.sendApproval(email).catch((error: unknown) => {
            unsent += 1;
            deps.log(`approval email to ${email} failed: ${String(error)}`);
          });
        }
      }
      const verbs: Record<Decision, string> = {
        approve: "Approved",
        decline: "Declined",
        undo: "Moved back to the waitlist",
      };
      const verb = verbs[decision as Decision];
      const notice =
        changed.length === 0
          ? "Nothing changed: those accounts had already moved."
          : `${verb} ${plural(changed.length, "account")}.${
              unsent > 0 ? ` ${plural(unsent, "approval email")} failed to send.` : ""
            }`;
      return Response.redirect(new URL(`/?done=${encodeURIComponent(notice)}`, url), 303);
    }

    return html(renderForbidden("Not found."), 404);
  };
}
