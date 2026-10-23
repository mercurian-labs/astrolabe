import type { Pool } from "pg";

/**
 * The waitlist, as the internal admin page (apps/admin) and
 * scripts/waitlist.ts see it: waitlisted accounts, and members (who joined
 * through an invitation) asking for an organization of their own. Decisions
 * only move accounts that are in a state the decision makes sense for, so a
 * repeated or stale click is a no-op.
 */
export interface WaitlistEntry {
  readonly email: string;
  readonly name: string;
  /** When they joined the waitlist, or asked for an organization. */
  readonly joinedAt: Date;
  /** A member asking for their own organization: approving promotes them, declining keeps them a member. */
  readonly wantsOrganization: boolean;
  /** How the person signs in: `credential` (password), `google`, … Empty for code-only accounts. */
  readonly methods: ReadonlyArray<string>;
}

export interface WaitlistDecision {
  readonly email: string;
  readonly name: string;
  readonly access: "approved" | "declined";
  readonly decidedAt: Date;
  /** Undo is off once an approved person has joined or created an organization. */
  readonly canUndo: boolean;
}

export type Decision = "approve" | "decline" | "undo";

export interface Waitlist {
  /** Everyone waiting for a decision, oldest first, optionally filtered by email or name. */
  readonly pending: (search?: string) => Promise<ReadonlyArray<WaitlistEntry>>;
  /** Approvals and declines from the last 30 days, newest first. */
  readonly recent: () => Promise<ReadonlyArray<WaitlistDecision>>;
  /** Applies a decision; returns the addresses it actually changed. */
  readonly decide: (decision: Decision, emails: ReadonlyArray<string>) => Promise<Array<string>>;
}

const transitions: Record<Decision, { readonly to: string; readonly from: ReadonlyArray<string> }> =
  {
    approve: { to: "approved", from: ["waitlisted", "declined"] },
    decline: { to: "declined", from: ["waitlisted"] },
    undo: { to: "waitlisted", from: ["approved", "declined"] },
  };

export function makeWaitlist(pool: Pool): Waitlist {
  return {
    pending: async (search) => {
      const pattern = search?.trim() ? `%${search.trim().toLowerCase()}%` : null;
      const result = await pool.query(
        `SELECT u.email, u.name, u.access = 'member' AS wants_organization,
                coalesce(u.org_requested_at, u.created_at) AS joined_at,
                coalesce(array_agg(a.provider_id ORDER BY a.provider_id)
                  FILTER (WHERE a.provider_id IS NOT NULL), '{}') AS methods
         FROM auth."user" u LEFT JOIN auth.account a ON a.user_id = u.id
         WHERE ((u.access = 'waitlisted' AND u.email_verified)
                OR (u.access = 'member' AND u.org_requested_at IS NOT NULL))
           AND ($1::text IS NULL OR lower(u.email) LIKE $1 OR lower(u.name) LIKE $1)
         GROUP BY u.id ORDER BY coalesce(u.org_requested_at, u.created_at)`,
        [pattern],
      );
      return result.rows.map((row) => ({
        email: row.email,
        name: row.name,
        joinedAt: row.joined_at,
        wantsOrganization: row.wants_organization,
        methods: row.methods,
      }));
    },
    recent: async () => {
      const result = await pool.query(
        `SELECT u.email, u.name, u.access, u.updated_at AS decided_at,
                NOT EXISTS (SELECT 1 FROM auth.member m WHERE m.user_id = u.id) AS can_undo
         FROM auth."user" u
         WHERE u.access IN ('approved', 'declined') AND u.updated_at > now() - interval '30 days'
         ORDER BY u.updated_at DESC LIMIT 200`,
      );
      return result.rows.map((row) => ({
        email: row.email,
        name: row.name,
        access: row.access,
        decidedAt: row.decided_at,
        canUndo: row.can_undo,
      }));
    },
    decide: async (decision, emails) => {
      if (emails.length === 0) return [];
      const { to, from } = transitions[decision];
      const result = await pool.query(
        `UPDATE auth."user" u
         SET access = CASE WHEN u.access = 'member' AND $1 <> 'approved' THEN 'member' ELSE $1 END,
             org_requested_at = NULL,
             updated_at = now()
         WHERE lower(u.email) = ANY($2::text[])
           AND (u.access = ANY($3::text[])
                OR ($1 <> 'waitlisted' AND u.access = 'member' AND u.org_requested_at IS NOT NULL))
           -- Taking back an approval would strand an organization the person already owns or joined.
           AND ($1 <> 'waitlisted' OR NOT EXISTS (SELECT 1 FROM auth.member m WHERE m.user_id = u.id))
         RETURNING u.email`,
        [to, emails.map((email) => email.toLowerCase()), from],
      );
      return result.rows.map((row) => row.email as string);
    },
  };
}
