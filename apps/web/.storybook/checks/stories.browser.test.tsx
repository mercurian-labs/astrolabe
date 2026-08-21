import { act, type JSX } from "react";
import { createRoot } from "react-dom/client";
import axe from "axe-core";
import { composeStories, setProjectAnnotations, type ReactRenderer } from "@storybook/react";
import type { ComposedStoryFn, Store_CSFExports } from "storybook/internal/types";
import { within } from "storybook/test";
import { describe, expect, it } from "vite-plus/test";

import preview from "../preview";

if (preview === undefined) {
  throw new Error("Storybook preview default export is undefined");
}

try {
  setProjectAnnotations(preview);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to set Storybook project annotations: ${message}`, { cause: error });
}

type StoryModule = Store_CSFExports<ReactRenderer>;

const storyModules = import.meta.glob<StoryModule>("../../src/**/*.stories.tsx", {
  eager: true,
});
console.log("[stories-harness] modules:", Object.keys(storyModules).length);

const storyTestName = (
  modulePath: string,
  exportKey: string,
  story: ComposedStoryFn<ReactRenderer>,
) => {
  try {
    return story.id || story.storyName;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read id/name for Storybook story ${modulePath}#${exportKey}: ${message}`,
      { cause: error },
    );
  }
};

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
  for (const [modulePath, storyModule] of Object.entries(storyModules)) {
    try {
      console.log(`[stories-harness] composing ${modulePath}`);
      const stories = composeStories(storyModule) as Record<string, ComposedStoryFn<ReactRenderer>>;

      for (const [exportKey, composedStory] of Object.entries(stories)) {
        const testName = storyTestName(modulePath, exportKey, composedStory);
        it(testName, async () => {
          const container = document.createElement("div");
          document.body.appendChild(container);
          const root = createRoot(container);
          const Story = composedStory;

          try {
            await composedStory.run({
              canvasElement: container,
              mount: async (ui?: JSX.Element) => {
                await act(async () => {
                  root.render(ui ?? <Story />);
                });
                return within(container);
              },
            });

            expect(container.innerHTML, `${composedStory.id} rendered no content`).not.toBe("");

            if (composedStory.parameters.a11y?.disable === true) {
              console.warn(
                `[storybook a11y] SKIPPING axe for ${composedStory.id}: parameters.a11y.disable`,
              );
              return;
            }

            const disabledRules: string[] = composedStory.parameters.a11y?.disabledRules ?? [];
            for (const rule of disabledRules) {
              console.warn(`[storybook a11y] DISABLING axe rule ${rule} for ${composedStory.id}`);
            }
            const results = await axe.run(container, {
              rules: Object.fromEntries(disabledRules.map((rule) => [rule, { enabled: false }])),
            });
            expect(
              results.violations,
              `Accessibility violations in ${composedStory.id}:\n${formatViolations(results.violations)}`,
            ).toHaveLength(0);
          } finally {
            await act(async () => {
              root.unmount();
            });
            container.remove();
          }
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to collect Storybook module ${modulePath}: ${message}`, {
        cause: error,
      });
    }
  }
});
