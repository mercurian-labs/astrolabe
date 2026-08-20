import type { Preview } from "@storybook/react";

import "../src/index.css";

const preview: Preview = {
  globalTypes: {
    appearance: {
      description: "Color appearance",
      defaultValue: "light",
      toolbar: {
        icon: "contrast",
        items: [
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      document.documentElement.classList.toggle("dark", context.globals.appearance === "dark");
      return <Story />;
    },
  ],
};

export default preview;
