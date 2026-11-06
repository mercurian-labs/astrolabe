const DEFAULT_MARKETING_SITE_URL = "https://astrolabe.sh";

function resolveMarketingSiteUrl(override: string | undefined): URL {
  try {
    const url = new URL(override?.trim() || DEFAULT_MARKETING_SITE_URL);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return new URL(DEFAULT_MARKETING_SITE_URL);
    }

    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
  } catch {
    return new URL(DEFAULT_MARKETING_SITE_URL);
  }
}

const MARKETING_SITE_URL = resolveMarketingSiteUrl(process.env.EXPO_PUBLIC_MARKETING_SITE_URL);

function marketingSiteDocumentUrl(path: string): string {
  return new URL(path, MARKETING_SITE_URL).toString();
}

// The landing site has no /legal index; each document's page links to the other two.
export const LEGAL_URL = marketingSiteDocumentUrl("privacy-policy");

const ALLOWED_LEGAL_DOCUMENT_URLS = [
  LEGAL_URL,
  marketingSiteDocumentUrl("terms-of-service"),
  marketingSiteDocumentUrl("licenses"),
] as const;

function webDocumentIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

const ALLOWED_LEGAL_DOCUMENT_IDENTITIES = new Set(
  ALLOWED_LEGAL_DOCUMENT_URLS.map(webDocumentIdentity).filter(
    (value): value is string => value !== null,
  ),
);

export function isLegalDocumentUrl(value: string): boolean {
  const identity = webDocumentIdentity(value);
  return identity !== null && ALLOWED_LEGAL_DOCUMENT_IDENTITIES.has(identity);
}
