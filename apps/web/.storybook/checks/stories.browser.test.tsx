import { act, type JSX } from "react";
import { createRoot } from "react-dom/client";
import axe from "axe-core";
import { composeStories, setProjectAnnotations, type ReactRenderer } from "@storybook/react";
import type { ComposedStoryFn, Store_CSFExports } from "storybook/internal/types";
import { within } from "storybook/test";
import { describe, expect, it } from "vite-plus/test";

import preview from "../preview";

setProjectAnnotations(preview);

type StoryModule = Store_CSFExports<ReactRenderer>;

const storyModules = import.meta.glob<StoryModule>("../../src/**/*.stories.tsx", {
  eager: true,
});

const formatViolations = (violations: axe.Result[]) =>
  violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.target.join(" ")}\n    ${node.failureSummary ?? node.html}`)
        .join("\n");

      return `- ${violation.id} (${violation.impact ?? "unknown impact"}): ${violation.help}\n${nodes}`;
    })
    .join("\n");

describe("Storybook catalog", () => {
  for (const storyModule of Object.values(storyModules)) {
    const stories = composeStories(storyModule) as Record<string, ComposedStoryFn<ReactRenderer>>;

    for (const story of Object.values(stories)) {
      it(story.id || story.storyName, async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        const Story = story;

        try {
          await story.run({
            canvasElement: container,
            mount: async (ui?: JSX.Element) => {
              await act(async () => {
                root.render(ui ?? <Story />);
              });
              return within(container);
            },
          });

          expect(container.innerHTML, `${story.id} rendered no content`).not.toBe("");

          if (story.parameters.a11y?.disable === true) {
            console.warn(`[storybook a11y] SKIPPING axe for ${story.id}: parameters.a11y.disable`);
            return;
          }

          const disabledRules: string[] = story.parameters.a11y?.disabledRules ?? [];
          for (const rule of disabledRules) {
            console.warn(`[storybook a11y] DISABLING axe rule ${rule} for ${story.id}`);
          }
          const results = await axe.run(container, {
            rules: Object.fromEntries(disabledRules.map((rule) => [rule, { enabled: false }])),
          });
          expect(
            results.violations,
            `Accessibility violations in ${story.id}:\n${formatViolations(results.violations)}`,
          ).toHaveLength(0);
        } finally {
          await act(async () => {
            root.unmount();
          });
          container.remove();
        }
      });
    }
  }
});
