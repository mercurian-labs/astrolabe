import { describe, expect, it } from "vite-plus/test";

import { renderPage } from "./pages.ts";

const page = `<html><head><!--mercurian-auth-config--></head><body><script type="module">boot()</script></body></html>`;

describe("renderPage", () => {
  it("writes the deployment's settings into the page and allows only its own scripts", async () => {
    const rendered = await renderPage(page, {
      providers: ["google"],
      turnstileSiteKey: null,
      returnOrigins: ["https://app.astrolabe.sh"],
    });

    expect(rendered.html).toContain(
      `<script>window.__MERCURIAN_AUTH__={"providers":["google"],"turnstileSiteKey":null,"returnOrigins":["https://app.astrolabe.sh"]}</script>`,
    );
    const csp = rendered.headers["content-security-policy"] ?? "";
    // One hash for the settings script, one for the app bundle; nothing else runs.
    expect(csp).toMatch(/script-src 'self' 'sha256-[^']+' 'sha256-[^']+';/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("can't be broken out of the settings script", async () => {
    const rendered = await renderPage(page, {
      providers: ["</script><script>alert(1)</script>"],
      turnstileSiteKey: null,
      returnOrigins: [],
    });

    expect(rendered.html).not.toContain("<script>alert(1)");
  });
});
