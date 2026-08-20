import type { Preview } from "@storybook/react";

import "../src/index.css";
import "./preview.css";
import { foundationsThemes } from "../src/foundations/foundations.logic";
import { applyThemePalette, type ThemeAppearance } from "../src/themePalette";

const themes = foundationsThemes();
const defaultTheme = themes[0]!;

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
    theme: {
      description: "Theme palette",
      defaultValue: defaultTheme.id,
      toolbar: {
        icon: "paintbrush",
        items: themes.map(({ id, label }) => ({ value: id, title: label })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      document.documentElement.classList.toggle("dark", context.globals.appearance === "dark");
      return <Story />;
    },
    (Story, context) => {
      const theme = themes.find(({ id }) => id === context.globals.theme) ?? defaultTheme;
      const appearance: ThemeAppearance = context.globals.appearance === "dark" ? "dark" : "light";
      applyThemePalette(theme.id, appearance);
      return <Story />;
    },
  ],
};

export default preview;
