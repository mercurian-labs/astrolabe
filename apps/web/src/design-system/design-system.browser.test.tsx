import { act } from "react";
import { createRoot } from "react-dom/client";
import axe from "axe-core";
import { describe, expect, it } from "vite-plus/test";

import "../index.css";
import { CATALOG_ENTRIES } from "./catalog";

const formatViolations = (violations: axe.Result[]) =>
  violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.target.join(" ")}\n    ${node.failureSummary ?? node.html}`)
        .join("\n");

      return `- ${violation.id} (${violation.impact ?? "unknown impact"}): ${violation.help}\n${nodes}`;
    })
    .join("\n");

describe.skipIf(typeof document === "undefined")("design-system catalog", () => {
  for (const entry of CATALOG_ENTRIES) {
    it(entry.id, async () => {
      const cleanup = entry.setup?.();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(entry.render({ themeId: "standard", appearance: "light" }));
        });

        expect(container.innerHTML, `${entry.id} rendered no content`).not.toBe("");

        if (entry.exercise) {
          await act(async () => {
            await entry.exercise?.(container);
          });
        }

        const axeExceptions = entry.axeExceptions ?? [];
        for (const { ruleId, reason } of axeExceptions) {
          console.warn(
            `[design-system a11y] DISABLING axe rule ${ruleId} for ${entry.id}: ${reason}`,
          );
        }
        const results = await axe.run(container, {
          rules: Object.fromEntries(
            axeExceptions.map(({ ruleId }) => [ruleId, { enabled: false }]),
          ),
        });
        expect(
          results.violations,
          `Accessibility violations in ${entry.id}:\n${formatViolations(results.violations)}`,
        ).toHaveLength(0);
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
        cleanup?.();
      }
    });
  }
});
