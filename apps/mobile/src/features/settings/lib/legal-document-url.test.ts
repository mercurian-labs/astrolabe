import { describe, expect, it } from "vite-plus/test";

import { isLegalDocumentUrl, LEGAL_URL } from "./legal-document-url";

describe("isLegalDocumentUrl", () => {
  it.each([LEGAL_URL, "https://astrolabe.sh/terms-of-service", "https://astrolabe.sh/licenses"])(
    "keeps a document in the site's legal switcher in the app: %s",
    (url) => {
      expect(isLegalDocumentUrl(url)).toBe(true);
    },
  );

  it.each(["https://example.com/legal", "javascript:alert(1)"])(
    "rejects a URL outside the legal-document allowlist: %s",
    (url) => {
      expect(isLegalDocumentUrl(url)).toBe(false);
    },
  );
});
