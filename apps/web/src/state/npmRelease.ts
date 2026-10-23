import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

/** The npm launcher package that servers not managed by the desktop app update from. */
export const NPM_LAUNCHER_PACKAGE = "@mercurian/astrolabe";

export const npmReleasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      // The registry takes a scoped name with its slash escaped: @scope%2Fname.
      const response = yield* HttpClient.get(
        `https://registry.npmjs.org/${NPM_LAUNCHER_PACKAGE.replace("/", "%2F")}/${encodeURIComponent(version)}`,
      );
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      return typeof body === "object" && body !== null && "version" in body
        ? body.version === version
        : false;
    }).pipe(
      // Tracing headers would make the browser send a CORS preflight, which npm rejects.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`npm-release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("npm-release-published:none"),
);

export function useNpmReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? npmReleasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}
