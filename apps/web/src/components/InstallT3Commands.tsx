import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

/**
 * Setup steps for another computer: install `astrolabe`, then run `command`. Both installers are shown
 * because the browser showing this is often not the computer being set up.
 */
export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">macOS, Linux</p>
      <CommandBlock command="curl -fsSL https://raw.githubusercontent.com/mercurian-labs/astrolabe/main/scripts/install.sh | sh" />
      <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
      <CommandBlock command="irm https://raw.githubusercontent.com/mercurian-labs/astrolabe/main/scripts/install.ps1 | iex" />
      <p className="text-xs text-muted-foreground">Then</p>
      <CommandBlock command={command} />
      <p className="text-xs text-muted-foreground">
        Skip the install if you already have <code className="font-mono">astrolabe</code>. If{" "}
        <code className="font-mono">astrolabe</code> is not found after installing, add the folder
        the installer names to your PATH.
      </p>
    </div>
  );
}
