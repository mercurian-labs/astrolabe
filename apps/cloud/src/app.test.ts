import { it } from "@effect/vitest";
import { betterAuth } from "better-auth";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { expect, vi } from "vite-plus/test";

import { makeCloudApp } from "./app.ts";

vi.mock("better-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth")>();
  return { ...actual, betterAuth: vi.fn(actual.betterAuth) };
});

it.effect("builds Better Auth once and serves every request with it", () =>
  Effect.gen(function* () {
    const app = yield* makeCloudApp({ sendMail: () => Effect.void });
    // A signed-out shape request asks Better Auth for the session without touching the database.
    const shapeStatus = app.fetch.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request("http://localhost:4310/api/workspaces/shape?shape=workspaces"),
        ),
      ),
      Effect.map((response) => HttpServerResponse.toWeb(response).status),
    );

    expect(betterAuth).not.toHaveBeenCalled();
    expect(yield* shapeStatus).toBe(401);
    expect(yield* shapeStatus).toBe(401);
    expect(betterAuth).toHaveBeenCalledTimes(1);
  }).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({
        DATABASE_URL: "postgresql://nobody@127.0.0.1:1/none",
        BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
        AUTH_URL: "http://localhost:4310",
      }),
    ),
  ),
);
