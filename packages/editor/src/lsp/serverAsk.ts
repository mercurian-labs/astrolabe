import { LSPPlugin, type WorkspaceMapping } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";

/**
 * Astrolabe: one thing an editor keeps asking its language server for as you work. An ask waits
 * for quiet, a newer ask replaces it, and one in flight is cancelled and its answer dropped.
 * Failures are dropped too: nobody asked for this answer, and the next ask brings a good one.
 */
export class ServerAsk {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sent: object | null = null;

  constructor(private readonly view: EditorView) {}

  /** Runs `run` after `delay` ms with no newer `schedule` or `cancel`. */
  schedule(delay: number, run: () => void) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      run();
    }, delay);
  }

  /** `params` is made after syncing, so its positions are the server's to read. */
  send<Answer>(
    method: string,
    params: (plugin: LSPPlugin) => object,
    then: (answer: Answer, mapping: WorkspaceMapping, plugin: LSPPlugin) => void,
    failed?: () => void,
  ) {
    const plugin = LSPPlugin.get(this.view);
    if (!plugin) return;
    this.cancelSent(plugin);
    plugin.client.sync();
    const sent = params(plugin);
    this.sent = sent;
    void plugin.client.withMapping((mapping) =>
      plugin.client.request<object, Answer>(method, sent).then(
        (answer) => {
          if (this.sent !== sent) return;
          this.sent = null;
          then(answer, mapping, plugin);
        },
        () => {
          if (this.sent !== sent) return;
          this.sent = null;
          failed?.();
        },
      ),
    );
  }

  private cancelSent(plugin: LSPPlugin | null) {
    if (this.sent !== null) plugin?.client.cancelRequest(this.sent);
    this.sent = null;
  }

  cancel() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.cancelSent(LSPPlugin.get(this.view));
  }
}
