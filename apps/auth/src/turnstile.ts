import { pageConfig } from "./config";

/**
 * Cloudflare Turnstile, when the deployment sets a site key. The widget runs
 * invisibly and refreshes its token; requests carry the latest one.
 */
let token: string | null = null;

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widget?: string) => void;
    };
  }
}

export function captchaHeaders(): Record<string, string> {
  return token ? { "x-captcha-response": token } : {};
}

export function mountTurnstile(): void {
  const siteKey = pageConfig.turnstileSiteKey;
  if (!siteKey) return;
  const container = document.createElement("div");
  container.style.display = "none";
  document.body.append(container);
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.addEventListener("load", () => {
    window.turnstile?.render(container, {
      sitekey: siteKey,
      size: "invisible",
      "refresh-expired": "auto",
      callback: (value: string) => {
        token = value;
      },
    });
  });
  document.head.append(script);
}
