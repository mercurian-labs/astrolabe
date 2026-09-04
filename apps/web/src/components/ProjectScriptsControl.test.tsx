import type { ProjectScript, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import ProjectScriptsControl from "./ProjectScriptsControl";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const PRIMARY_SCRIPT: ProjectScript = {
  id: "dev",
  name: "Dev",
  command: "vp dev",
  icon: "play",
  runOnWorktreeCreate: false,
};

describe("ProjectScriptsControl compact controls", () => {
  it("supports a run-only surface with no management affordance", () => {
    const html = renderToStaticMarkup(
      <ProjectScriptsControl
        scripts={[PRIMARY_SCRIPT]}
        fileScripts={[
          {
            name: "Build",
            command: "vp build",
            icon: "build",
            runOnWorktreeCreate: false,
          },
        ]}
        keybindings={EMPTY_KEYBINDINGS}
        onRunScript={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Run Dev"');
    expect(html).not.toContain("Add action");
    expect(html).not.toContain("Edit Dev");
    expect(html).not.toContain("From t3.json");
  });
});
