// @effect-diagnostics globalConsole:off - a command-line tool prints its results.
/**
 * Waitlist approvals from a terminal; apps/admin is the same over the tailnet.
 * Members who asked to own an organization are in the same queue.
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

import { makeWaitlist } from "../src/admin/waitlist.ts";
import * as Mailer from "../src/mail/Mailer.ts";
import { approvedMail } from "../src/mail/templates.ts";

const [command, email] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const signInUrl = process.env.AUTH_URL ?? "https://app.astrolabe.sh";
const mailFrom = process.env.MAIL_FROM;

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

const waitlist = makeWaitlist(pool);

try {
  if (command === "list") {
    for (const entry of await waitlist.pending()) {
      const why = entry.wantsOrganization ? "wants an org" : "waitlisted";
      console.log(
        `${entry.joinedAt.toISOString().slice(0, 16)} UTC  ${why.padEnd(12)}  ${entry.email}  ${entry.name}`,
      );
    }
  } else if (command === "approve" || command === "decline") {
    if (!email) throw new Error(`usage: waitlist.ts ${command} <email>`);
    const [changed] = await waitlist.decide(command, [email]);
    if (changed === undefined) throw new Error(`no one waiting for approval at ${email}`);
    if (command === "approve") {
      const mailer = mailFrom === undefined ? Mailer.layerLog : Mailer.layerSes(mailFrom);
      await Effect.runPromise(
        Mailer.Mailer.use((service) => service.send(approvedMail(changed, signInUrl))).pipe(
          Effect.provide(mailer),
        ),
      );
    }
    console.log(`${command === "approve" ? "approved" : "declined"} ${changed}`);
  } else {
    throw new Error("usage: waitlist.ts list | approve <email> | decline <email>");
  }
} finally {
  await pool.end();
}
