import { describe, expect, it } from "vite-plus/test";

import { decideCors } from "./cors.ts";

const trusted = ["https://app.astrolabe.sh"];
const request = (origin: string | undefined, preflight = false) => ({
  method: preflight ? "OPTIONS" : "POST",
  origin,
  requestedMethod: preflight ? "POST" : undefined,
});

describe("CORS", () => {
  it("lets the hosted web app send its cookie", () => {
    const { headers } = decideCors(request(trusted[0]), trusted);
    expect(headers["access-control-allow-origin"]).toBe(trusted[0]);
    expect(headers["access-control-allow-credentials"]).toBe("true");
  });

  it("lets any other origin call with a bearer token, never with credentials", () => {
    for (const origin of ["http://192.168.1.20:3773", "astrolabe://app"]) {
      const { headers } = decideCors(request(origin), trusted);
      expect(headers["access-control-allow-origin"]).toBe(origin);
      expect(headers["access-control-allow-credentials"]).toBeUndefined();
    }
  });

  it("answers preflights with the methods and headers clients send", () => {
    const decision = decideCors(request("astrolabe://app", true), trusted);
    expect(decision.preflight).toBe(true);
    expect(decision.headers["access-control-allow-headers"]).toBe("content-type, authorization");
    expect(decision.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
