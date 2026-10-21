import { StateEffect } from "@codemirror/state";

// KaTeX loads on the first math node a document shows and never before, so a document
// without math pays nothing. Until it arrives, math renders as styled source.

type Katex = typeof import("katex");

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

/**
 * Loads the KaTeX runtime once and caches it. The live preview calls it when it first
 * meets a math node; tests await it to see rendered math.
 */
export function loadKatex() {
  loading ??= import("katex").then(
    (module) => {
      katex = module;
      return module;
    },
    (error: unknown) => {
      // Let a later math node try again, say after a failed chunk request.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Whether KaTeX has arrived, so math can render instead of showing its source. */
export const katexLoaded = () => katex !== null;

/** Whether something has asked for KaTeX since the page loaded (or since `unloadKatex`). */
export const katexRequested = () => loading !== null;

/** Forgets the loaded runtime, as a fresh page would; tests use it to replay the first load. */
export function unloadKatex() {
  katex = null;
  loading = null;
}

/** Dispatched to a view once KaTeX arrives, so its decorations rebuild with rendered math. */
export const mathLoaded = StateEffect.define<null>();

function markError(element: HTMLElement, message: string) {
  element.classList.add("cm-md-math-error");
  element.title = message;
}

/**
 * Renders `tex` into `element` with KaTeX. KaTeX's output is safe markup under
 * `trust: false`, and it is the only string ever set as HTML. A TeX error renders KaTeX's
 * error markup, marked with the error class and the message as a title.
 */
export function fillMath(element: HTMLElement, tex: string, displayMode: boolean) {
  if (!katex) {
    element.textContent = tex;
    return;
  }
  try {
    element.innerHTML = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: "ignore",
    });
  } catch (error) {
    element.textContent = tex;
    markError(element, error instanceof Error ? error.message : String(error));
    return;
  }
  const failed = element.querySelector(".katex-error");
  if (failed) markError(element, failed.getAttribute("title") ?? "");
}
