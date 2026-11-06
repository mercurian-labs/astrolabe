import { useAtomMount, useAtomValue } from "@effect/atom-react";
import type {
  LanguageServerInfo,
  LanguageServerLogItem,
  LanguageServerLogLine,
  LanguageServerTraceEntry,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { formatBytes } from "~/lib/formatBytes";
import { TabHeader } from "~/panes/TabHeader";
import { languageServersEnvironment } from "~/state/languageServers";
import { useAtomCommand } from "~/state/use-atom-command";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { createLogText, type LogText } from "./logText";
import type { RepositoryLanguageServerLogsTab } from "./repositoryTabs";

/**
 * Astrolabe: what a language server is doing: its output, its LSP traffic while recording, and
 * the process behind it. Batches go straight to the editors, so a busy server re-renders nothing.
 */

type Panel = "log" | "trace" | "info";

const timeOf = (at: number) => new Date(at).toISOString().slice(11, 23);

const SOURCES: Record<LanguageServerLogLine["source"], string> = {
  stderr: "stderr",
  log: "log",
  message: "message",
  environment: "astrolabe",
};

const lineText = (line: LanguageServerLogLine) =>
  [timeOf(line.at), line.severity ?? SOURCES[line.source], line.text].join("  ");

const traceText = (entry: LanguageServerTraceEntry) =>
  `${timeOf(entry.at)}  ${entry.direction === "sent" ? "→" : "←"}  ${entry.text}`;

/** Where the stream's batches go: the editors, while they exist. */
function createLogSink() {
  let texts: { readonly log: LogText; readonly trace: LogText } | null = null;
  return {
    attach(log: LogText, trace: LogText) {
      texts = { log, trace };
      return () => {
        texts = null;
      };
    },
    take(item: LanguageServerLogItem) {
      const lines = item.lines.map(lineText);
      const trace = item.trace.map(traceText);
      if (item.type === "snapshot") {
        texts?.log.replace(lines);
        texts?.trace.replace(trace);
      } else {
        texts?.log.append(lines);
        texts?.trace.append(trace);
      }
    },
  };
}

function Info({ info }: { readonly info: LanguageServerInfo | null }) {
  if (info === null) {
    return (
      <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
        Not running. It starts when a file it reads opens.
      </p>
    );
  }
  const rows: ReadonlyArray<readonly [string, string | null]> = [
    ["Name", info.name],
    ["State", info.restricted ? `${info.state} (restricted)` : info.state],
    ["Version", info.version],
    ["Binary", info.binary],
    ["Arguments", info.args.join(" ")],
    ["Folder", info.cwd],
    ["Process", info.pid === null ? null : String(info.pid)],
    ["Memory", info.memoryBytes === null ? null : formatBytes(info.memoryBytes)],
    ["Note", info.message],
  ];
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-xs">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
        {rows.flatMap(([label, value]) =>
          value
            ? [
                <dt key={label} className="text-muted-foreground">
                  {label}
                </dt>,
                <dd key={`${label}:value`} className="font-mono break-all">
                  {value}
                </dd>,
              ]
            : [],
        )}
      </dl>
      {info.capabilities === null ? null : (
        <>
          <h3 className="mt-4 mb-1 text-muted-foreground">Capabilities</h3>
          <pre className="font-mono whitespace-pre-wrap break-all">{info.capabilities}</pre>
        </>
      )}
    </div>
  );
}

export function LanguageServerLogsView({ tab }: { readonly tab: RepositoryLanguageServerLogsTab }) {
  const { environmentId, cwd, server } = tab;
  const canRecord = useAtomValue(languageServersEnvironment.setTrace.permissionAtom(environmentId));
  const setTrace = useAtomCommand(languageServersEnvironment.setTrace, "language server trace");
  const [panel, setPanel] = useState<Panel>("log");
  const [state, setState] = useState<{
    readonly info: LanguageServerInfo | null;
    readonly tracing: boolean;
  } | null>(null);
  const [traced, setTraced] = useState(false);
  const logHost = useRef<HTMLDivElement>(null);
  const traceHost = useRef<HTMLDivElement>(null);
  const [sink] = useState(createLogSink);
  // Declared before the subscription mounts: its first item finds the editors there.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the editors are outside React and take batches from the stream
  useEffect(() => {
    const log = createLogText(logHost.current!);
    const trace = createLogText(traceHost.current!);
    const detach = sink.attach(log, trace);
    return () => {
      detach();
      log.destroy();
      trace.destroy();
    };
  }, [sink]);
  const [follow] = useState(() =>
    languageServersEnvironment.logs(environmentId, { cwd, server }, (item) => {
      sink.take(item);
      if (item.type === "snapshot" || item.trace.length > 0) setTraced(item.trace.length > 0);
      if (item.state !== undefined) setState(item.state);
    }),
  );
  useAtomMount(follow);
  const tracing = state?.tracing ?? false;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabHeader.Root>
        <TabHeader.Title label="Language server logs" parent={cwd} keepParentEnd>
          {state?.info?.name ?? server}
        </TabHeader.Title>
        <ToggleGroup
          aria-label="What to show"
          className="shrink-0"
          value={[panel]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "log" || next === "trace" || next === "info") setPanel(next);
          }}
        >
          <Toggle value="log">Server log</Toggle>
          <Toggle value="trace">RPC trace</Toggle>
          <Toggle value="info">Server info</Toggle>
        </ToggleGroup>
        {panel === "trace" ? (
          <TabHeader.Status>
            <label className="flex items-center gap-2">
              Record
              <Switch
                aria-label="Record the RPC trace"
                checked={tracing}
                disabled={!canRecord || state === null}
                onCheckedChange={(enabled) =>
                  void setTrace({ environmentId, input: { cwd, server, enabled } })
                }
              />
            </label>
          </TabHeader.Status>
        ) : null}
      </TabHeader.Root>
      <div ref={logHost} hidden={panel !== "log"} className="min-h-0 flex-1 overflow-hidden" />
      {panel === "trace" && !tracing && !traced ? (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Recording is off. Turn it on to see every message both ways. Messages can hold file
          contents, so they stay in the environment's memory and go when nobody is reading them.
        </p>
      ) : null}
      <div ref={traceHost} hidden={panel !== "trace"} className="min-h-0 flex-1 overflow-hidden" />
      {panel === "info" ? <Info info={state?.info ?? null} /> : null}
    </div>
  );
}
