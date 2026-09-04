import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerTasksBadge, ComposerTasksDrawer } from "./ComposerTasksBadge";

const progress = {
  step: "Attach task progress",
  completedSteps: 1,
  totalSteps: 3,
};
const steps = [
  { durationMs: 4_000, step: "Inspect the composer", status: "completed" as const },
  { step: "Attach task progress", status: "inProgress" as const },
  { step: "Verify the result", status: "pending" as const },
];

describe("ComposerTasksBadge", () => {
  it("renders active progress as an attached composer tab", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onToggle={() => undefined}
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain('data-composer-tasks-badge="true"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("data-composer-shoulder-tab");
    expect(markup).toContain('data-composer-banner-surface="attached"');
    expect(markup).toContain('data-composer-task-current="true"');
    expect(markup).toContain("min-w-0 flex-1 truncate");
    expect(markup).toContain("w-20");
    expect(markup).toContain("Tasks");
    expect(markup).toContain("Attach task progress");
    expect(markup).not.toContain("·");
    expect(markup).toContain("1/3");
    expect(markup).toContain("Current task: Attach task progress");
    expect(markup).toContain("lucide-list-todo");
    expect(markup).toContain("lucide-chevron-down");
    expect(markup).toContain("rotate-180");
    expect(markup).toContain("bg-success");
    expect(markup).toContain("bg-primary");
    expect(markup).toContain("bg-muted-foreground/25");
  });

  it("uses the shared shoulder surface alongside the stash tab", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onToggle={() => undefined}
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain("data-composer-shoulder-tab");
    expect(markup).not.toContain("chat-composer-shoulder-tab");
  });

  it("has a compact inline fallback for occupied composer shoulders", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onToggle={() => undefined}
        placement="inline"
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain('data-composer-tasks-badge="true"');
    expect(markup).toContain("1/3");
    expect(markup).not.toContain("data-composer-shoulder-tab");
  });

  it("expands into a read-only attached task list", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksDrawer onCollapse={() => undefined} progress={progress} steps={steps} />,
    );

    expect(markup).toContain('data-chat-composer-tasks-drawer="true"');
    expect(markup).toContain('data-composer-banner-surface="attached"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="list"');
    expect(markup).toContain("Inspect the composer");
    expect(markup).toContain('data-composer-task-duration="true"');
    expect(markup).toContain("w-10 text-right");
    expect(markup).toContain("4.0s");
    expect(markup).toContain("now");
    expect(markup).toContain("Attach task progress");
    expect(markup).toContain("Verify the result");
    expect(markup).toContain("lucide-list-todo");
    expect(markup).toContain("lucide-chevron-down");
    expect(markup).toContain("bg-success");
    expect(markup).toContain("bg-primary");
    expect(markup).toContain("bg-muted-foreground/25");
  });

  it("does not render an empty task count", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onToggle={() => undefined}
        progress={{ ...progress, totalSteps: 0 }}
        steps={steps}
      />,
    );

    expect(markup).toBe("");
  });
});
