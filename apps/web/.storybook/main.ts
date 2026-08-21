import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    plugins: [...(viteConfig.plugins ?? []), ...tailwindcss()],
    resolve: {
      ...viteConfig.resolve,
      tsconfigPaths: true,
      dedupe: ["react", "react-dom"],
    },
  }),
};

export default config;
