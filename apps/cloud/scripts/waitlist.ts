// @effect-diagnostics globalConsole:off - a command-line tool prints its results.
/**
 * Waitlist approvals until the admin page exists. Members who asked to own
 * an organization are in the same queue.
 *
 *   node scripts/waitlist.ts list
 *   node scripts/waitlist.ts approve someone@example.com
 *   node scripts/waitlist.ts decline someone@example.com
 *
 * Needs DATABASE_URL. Approving emails the person when MAIL_FROM is set
 * (through SES); otherwise the mail goes to the log.
 */
import * as Effect from "effect/Effect";
import { Pool } from "pg";

import * as Mailer from "../src/mail/Mailer.ts";
import { approvedMail } from "../src/mail/templates.ts";

const [command, email] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const signInUrl = process.env.AUTH_URL ?? "https://app.astrolabe.sh";
const mailFrom = process.env.MAIL_FROM;

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

const setAccess = async (to: "approved" | "declined") => {
  if (!email) throw new Error(`usage: waitlist.ts ${command} <email>`);
  // Waitlisted accounts move either way. A member moves only if they asked for
  // their own organization: approving promotes them, declining keeps them a member.
  const result = await pool.query(
    `UPDATE auth."user"
     SET access = CASE WHEN access = 'member' AND $1 = 'declined' THEN 'member' ELSE $1 END,
         org_requested_at = NULL,
         updated_at = now()
     WHERE lower(email) = lower($2)
       AND (access IN ('waitlisted', 'declined') OR (access = 'member' AND org_requested_at IS NOT NULL))
     RETURNING email`,
    [to, email],
  );
  if (result.rowCount === 0) throw new Error(`no one waiting for approval at ${email}`);
  return result.rows[0].email as string;
};

try {
  if (command === "list") {
    const result = await pool.query(
      `SELECT email, name, access, to_char(coalesce(org_requested_at, created_at), 'YYYY-MM-DD HH24:MI') AS since
       FROM auth."user"
       WHERE (access = 'waitlisted' AND email_verified) OR (access = 'member' AND org_requested_at IS NOT NULL)
       ORDER BY coalesce(org_requested_at, created_at)`,
    );
    for (const row of result.rows) {
      const why = row.access === "member" ? "wants an org" : "waitlisted";
      console.log(`${row.since} UTC  ${why.padEnd(12)}  ${row.email}  ${row.name}`);
    }
  } else if (command === "approve") {
    const approved = await setAccess("approved");
    const mailer = mailFrom === undefined ? Mailer.layerLog : Mailer.layerSes(mailFrom);
    await Effect.runPromise(
      Mailer.Mailer.use((service) => service.send(approvedMail(approved, signInUrl))).pipe(
        Effect.provide(mailer),
      ),
    );
    console.log(`approved ${approved}`);
  } else if (command === "decline") {
    console.log(`declined ${await setAccess("declined")}`);
  } else {
    throw new Error("usage: waitlist.ts list | approve <email> | decline <email>");
  }
} finally {
  await pool.end();
}
