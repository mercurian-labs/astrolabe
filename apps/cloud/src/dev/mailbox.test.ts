import { expect, it } from "vite-plus/test";

import { renderMailbox } from "./mailbox.ts";

const mail = (Timestamp: string, Subject: string) => ({
  Timestamp,
  Source: "Astrolabe <login@astrolabe.sh>",
  Destination: { ToAddresses: ["someone@example.com"] },
  Subject,
  Body: { text_part: "Your code is 123456. <b>" },
});

it("lists mail newest first and escapes what it shows", () => {
  const html = renderMailbox([
    mail("2026-10-15T10:00:00Z", "111111 is your Astrolabe sign-in code"),
    mail("2026-10-15T11:00:00Z", "222222 is your Astrolabe sign-in code"),
  ]);
  expect(html.indexOf("222222")).toBeLessThan(html.indexOf("111111"));
  expect(html).toContain("&lt;b&gt;");
  expect(html).not.toContain("<b>");
});
