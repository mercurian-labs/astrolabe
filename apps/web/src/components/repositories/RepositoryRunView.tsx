import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthTerminalOperateScope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ClipboardIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useContext, useSyncExternalStore } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "~/appearanceFonts";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { PanesHostContext } from "~/panes/panesHost";
import { TabHeader } from "~/panes/TabHeader";
import { leaves } from "~/panes/tree";
import { workspace } from "~/panes/workspace";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useKnownTerminalSessions } from "~/state/terminalSessions";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { runNotices, type RunTab, runTerminalOf, startRun, stopRun } from "./runTabs";

const noop = () => undefined;

/** A run: its exact command over its terminal, with the way to run it again or stop it. */
export function RepositoryRunView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RunTab;
}) {
  const { environmentId } = tab;
  const { threadId, terminalId, cwd, worktreePath } = runTerminalOf(tab);
  const panes = useContext(PanesHostContext)?.controller ?? workspace.store;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const canOperate = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const sessions = useKnownTerminalSessions({ environmentId, threadId });
  const session = sessions?.find((known) => known.target.terminalId === terminalId);
  const running = session?.state.summary?.hasRunningSubprocess === true;
  const visible = useSyncExternalStore(workspace.store.subscribe, () =>
    leaves(workspace.arrangement().root).some((leaf) => leaf.active === tabKey),
  );
  const notice = useSyncExternalStore(runNotices.subscribe, () => runNotices.get(terminalId));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabHeader.Root>
        <Tooltip>
          <TooltipTrigger
            render={
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" />
            }
          >
            {tab.command}
          </TooltipTrigger>
          <TooltipPopup side="bottom" variant="code">
            {tab.command}
          </TooltipPopup>
        </Tooltip>
        {running ? <TabHeader.Status>Running</TabHeader.Status> : null}
        <TabHeader.Actions>
          <TabHeader.Action
            label="Copy command"
            onClick={() => void writeTextToClipboard(tab.command).catch(noop)}
          >
            <ClipboardIcon />
          </TabHeader.Action>
          {running ? (
            <TabHeader.Action label="Stop" disabled={!canOperate} onClick={() => stopRun(tab)}>
              <SquareIcon />
            </TabHeader.Action>
          ) : null}
          <TabHeader.Action
            label="Run again"
            disabled={!canOperate}
            onClick={() => void startRun(tab, panes, null)}
          >
            <PlayIcon />
          </TabHeader.Action>
        </TabHeader.Actions>
      </TabHeader.Root>
      {notice === null ? null : (
        <p
          role="status"
          className="shrink-0 border-b border-border bg-warning-surface px-3 py-1.5 text-xs text-warning-foreground"
        >
          {notice}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
        <TerminalViewport
          advancedTypography={advancedTypography}
          threadRef={scopeThreadRef(environmentId, threadId)}
          threadId={threadId}
          terminalId={terminalId}
          terminalLabel={tab.name}
          cwd={cwd}
          worktreePath={worktreePath}
          onSessionExited={noop}
          visible={visible}
          keybindings={keybindings}
        />
      </div>
    </div>
  );
}
