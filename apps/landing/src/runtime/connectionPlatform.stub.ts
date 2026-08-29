import { Layer, Stream } from "../../../web/node_modules/effect/dist/index.js";
import { PlatformConnectionSource } from "../../../../packages/client-runtime/src/platform/source";

import { connectionPlatformLayer as realConnectionPlatformLayer } from "../../../web/src/connection/platform";

export * from "../../../web/src/connection/platform";

const quietPlatformConnectionSourceLayer = Layer.succeed(
  PlatformConnectionSource,
  PlatformConnectionSource.of({
    registrations: Stream.make([]).pipe(Stream.concat(Stream.never)),
  }),
);

export const connectionPlatformLayer = Layer.mergeAll(
  realConnectionPlatformLayer,
  quietPlatformConnectionSourceLayer,
);
