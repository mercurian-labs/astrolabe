import type { ServerProviderSkill } from "@t3tools/contracts";
import { createRef, useState } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../ComposerPromptEditor";

const babysit: ServerProviderSkill = {
  name: "babysit",
  path: "/skills/babysit/SKILL.md",
  enabled: true,
};

const editorRef = createRef<ComposerPromptEditorHandle>();
const NO_SKILLS: ReadonlyArray<ServerProviderSkill> = [];
const DRAFTS = { a: "Draft A", b: "Draft B" };

/** A composer over two drafts, which keeps each draft's text and cursor as the store does. */
function Composer({
  draftKey = "a",
  richTextEnabled = true,
  skills = NO_SKILLS,
  initial = DRAFTS,
}: {
  draftKey?: "a" | "b";
  richTextEnabled?: boolean;
  skills?: ReadonlyArray<ServerProviderSkill>;
  initial?: Record<"a" | "b", string>;
}) {
  const [drafts, setDrafts] = useState({
    a: { value: initial.a, cursor: 0 },
    b: { value: initial.b, cursor: 0 },
  });
  const draft = drafts[draftKey];
  return (
    <>
      <output data-value={draft.value} />
      <ComposerPromptEditor
        draftKey={draftKey}
        editorRef={editorRef}
        value={draft.value}
        cursor={draft.cursor}
        richTextEnabled={richTextEnabled}
        contextRecords={new Map()}
        skills={skills}
        disabled={false}
        placeholder=""
        onChange={(value, cursor) =>
          setDrafts((current) => ({ ...current, [draftKey]: { value, cursor } }))
        }
        onPaste={() => {}}
      />
    </>
  );
}

function editorElement(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('[data-testid="composer-editor"]');
  if (!element) throw new Error("Composer did not mount");
  return element;
}

const valueIn = (container: HTMLElement) => container.querySelector("output")?.dataset.value;

it("keeps typing focus in the editor that replaces a focused one, and leaves other focus alone", async () => {
  await using screen = await render(<Composer />);
  const previous = editorElement(screen.container);
  await act(async () => editorRef.current?.focusAtEnd());
  expect(document.activeElement).toBe(previous);

  await screen.rerender(<Composer draftKey="b" />);
  const next = editorElement(screen.container);
  expect(next).not.toBe(previous);
  expect(document.activeElement).toBe(next);
  await userEvent.keyboard("x");
  expect(valueIn(screen.container)).toBe("xDraft B");

  const button = document.createElement("button");
  screen.container.append(button);
  button.focus();
  await screen.rerender(<Composer draftKey="a" />);
  expect(document.activeElement).toBe(button);
  expect(valueIn(screen.container)).toBe("Draft A");
});

it("keeps focus and the caret inside dollar text that is not a skill across text modes", async () => {
  const initial = { a: "echo $HOME now", b: "" };
  await using screen = await render(<Composer initial={initial} />);
  await act(async () => editorRef.current?.focusAtEnd());
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");

  await screen.rerender(<Composer initial={initial} richTextEnabled={false} />);
  await userEvent.keyboard("X");
  expect(valueIn(screen.container)).toBe("echo $HOXME now");

  await screen.rerender(<Composer initial={initial} />);
  await userEvent.keyboard("Y");
  expect(valueIn(screen.container)).toBe("echo $HOXYME now");
});

it("shows a skill chip only while the provider offers the skill, with its description", async () => {
  const initial = { a: "run $babysit now", b: "" };
  const chip = () => page.getByRole("button", { name: "Skill Babysit. Show details" });
  await using screen = await render(
    <Composer initial={initial} skills={[{ ...babysit, enabled: false }]} />,
  );
  await expect.element(chip()).not.toBeInTheDocument();
  await screen.rerender(
    <Composer initial={initial} skills={[{ ...babysit, userInvocable: false }]} />,
  );
  await expect.element(chip()).not.toBeInTheDocument();

  await screen.rerender(
    <Composer
      initial={initial}
      skills={[{ ...babysit, shortDescription: "  Watches the build  " }]}
    />,
  );
  await chip().click();
  await expect.element(page.getByText("Watches the build")).toBeVisible();
  await screen.rerender(<Composer initial={initial} skills={[babysit]} />);
  await expect.element(page.getByText("No description is available for this skill.")).toBeVisible();
  expect(valueIn(screen.container)).toBe(initial.a);
});
