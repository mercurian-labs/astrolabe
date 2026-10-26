import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_HOSTED_APP_URL } from "./connectAuth.ts";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  it.each(["astrolabe", "astrolabe-dev"])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it("returns to the hosted app's settings", () => {
    expect(providerAuthReturnUrl(`${DEFAULT_HOSTED_APP_URL}/settings/providers?code=secret`)).toBe(
      `${DEFAULT_HOSTED_APP_URL}/settings/providers`,
    );
  });
  it.each([
    "astrolabe://attacker/welcome",
    "https://app.t3.codes/welcome",
    "astrolabe://app/welcome/../evil",
    "https://attacker.example/welcome",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
