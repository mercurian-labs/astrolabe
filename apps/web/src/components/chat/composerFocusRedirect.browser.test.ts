import { expect, it } from "vite-plus/test";

import { shouldTypeToFocusComposer } from "./composerFocusRedirect";

function keyFrom(target: HTMLElement, key: string): KeyboardEvent {
  let seen: KeyboardEvent | null = null;
  const listener = (event: KeyboardEvent) => {
    seen = event;
  };
  window.addEventListener("keydown", listener, { capture: true });
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  window.removeEventListener("keydown", listener, { capture: true });
  return seen!;
}

it("leaves keys on a focused tree row to the row", () => {
  using host = mount('<div role="tree"><div role="treeitem" tabindex="0">Thread</div></div>');
  const row = host.element.querySelector<HTMLElement>('[role="treeitem"]')!;
  expect(shouldTypeToFocusComposer(keyFrom(row, " "))).toBe(false);
  expect(shouldTypeToFocusComposer(keyFrom(row, "j"))).toBe(false);
});

it("still sends typing on plain page content to the composer", () => {
  using host = mount("<p>Conversation</p>");
  const text = host.element.querySelector<HTMLElement>("p")!;
  expect(shouldTypeToFocusComposer(keyFrom(text, "a"))).toBe(true);
});

function mount(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.append(element);
  return { element, [Symbol.dispose]: () => element.remove() };
}
