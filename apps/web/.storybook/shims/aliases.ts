import * as NodeURL from "node:url";

const resolved = (path: string) => NodeURL.fileURLToPath(new URL(path, import.meta.url));

export const storybookAliases = {
  "storybook-tanstack-react-router-real": resolved(
    "../../node_modules/@tanstack/react-router/dist/esm/index.js",
  ),
  "@tanstack/react-router": resolved("./router.ts"),
  [resolved("../../src/state/mercurian.ts")]: resolved("./stateMercurian.ts"),
  [resolved("../../src/state/environments.ts")]: resolved("./stateEnvironments.ts"),
  [resolved("../../src/assets/assetUrls.ts")]: resolved("./assetUrls.ts"),
};
