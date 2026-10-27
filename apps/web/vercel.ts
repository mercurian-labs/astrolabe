import { routes, type VercelConfig } from "@vercel/config/v1";

// Labelled PR previews only (.github/workflows/web-preview.yml). app.astrolabe.sh is a Cloudflare
// Worker (wrangler.jsonc).
export const config: VercelConfig = {
  buildCommand:
    'vp run --filter @t3tools/web build && node ../../scripts/apply-web-brand-assets.ts --channel "${VITE_HOSTED_APP_CHANNEL:-latest}"',
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --ignore-scripts --filter '@t3tools/scripts...' --filter '@t3tools/web...'",
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
