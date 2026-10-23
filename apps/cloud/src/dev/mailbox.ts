// @effect-diagnostics globalFetch:off - a dev-only page reading the local emulator's mail store.
/**
 * `/dev/mailbox`: the mail the local stack has sent, newest first, like
 * Phoenix's Swoosh mailbox. Codes go through the emulated SES, which keeps
 * every message at `<AWS_ENDPOINT_URL>/_aws/ses`. Only served when
 * AWS_ENDPOINT_URL is set, which only the local emulator does.
 */
interface StoredMail {
  readonly Timestamp: string;
  readonly Source: string;
  readonly Destination: { readonly ToAddresses: ReadonlyArray<string> };
  readonly Subject: string;
  readonly Body: { readonly text_part: string | null };
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/gu,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

export const renderMailbox = (messages: ReadonlyArray<StoredMail>) => {
  const rows = [...messages]
    .sort((a, b) => b.Timestamp.localeCompare(a.Timestamp))
    .slice(0, 100)
    .map(
      (mail) => `<article>
  <header><time>${escape(mail.Timestamp.slice(0, 19).replace("T", " "))}</time>
  <strong>${escape(mail.Destination.ToAddresses.join(", "))}</strong></header>
  <h2>${escape(mail.Subject)}</h2>
  <pre>${escape(mail.Body.text_part ?? "")}</pre>
</article>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Local mailbox</title>
<meta http-equiv="refresh" content="5">
<style>body{font:14px system-ui;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#222}
article{border:1px solid #ddd;border-radius:6px;padding:.75rem 1rem;margin:.75rem 0}
header{display:flex;gap:1rem;color:#666}h2{font-size:1.1rem;margin:.4rem 0}
pre{white-space:pre-wrap;margin:0;color:#444}</style></head>
<body><h1>Local mailbox</h1><p>Mail the local stack sent, newest first. Refreshes every 5 seconds.</p>
${rows || "<p>No mail yet.</p>"}</body></html>`;
};

export const loadMailbox = async (endpoint: string) => {
  const response = await fetch(new URL("/_aws/ses", endpoint));
  const { messages } = (await response.json()) as { messages: ReadonlyArray<StoredMail> };
  return renderMailbox(messages);
};
