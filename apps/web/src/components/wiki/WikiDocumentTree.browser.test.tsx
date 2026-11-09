import {
  EnvironmentId,
  WikiId,
  type WikiChangeRequest,
  type WikiSummary,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { WikiDocumentTree, type WikiTreeActions } from "./WikiDocumentTree";
import type { WikiDocumentItem } from "./wikiTabs";

const environmentId = EnvironmentId.make("laptop");
const wiki = { wikiId: WikiId.make("wiki"), name: "Notes" } as WikiSummary;

const item = (file: string, changes: ReadonlyArray<WikiChangeRequest> = []): WikiDocumentItem => ({
  key: file,
  environmentId,
  wiki,
  name: file.replace(/\.md$/, ""),
  title: file,
  file,
  base: false,
  canvas: false,
  links: 0,
  backlinks: 0,
  editedAt: null,
  changes,
});

const actions = (): WikiTreeActions => ({
  open: vi.fn(),
  select: vi.fn(),
  selection: () => 1,
  openAll: vi.fn(),
  carry: vi.fn(),
  carryFolder: vi.fn(),
  move: vi.fn(async () => true),
  moveTo: vi.fn(),
  create: vi.fn(),
});

/** Pierre's rows live in a shadow root, which locators pierce. */
const row = (name: string) => page.getByRole("treeitem", { name });

it("lists folders, opens a document on a click, and reveals the one in front", async () => {
  const done = actions();
  await using _screen = await render(
    <ul>
      <WikiDocumentTree
        documents={[item("Top.md"), item("a/deep/Plan.md")]}
        outsideFilter={null}
        focusedFile="a/deep/Plan.md"
        actions={done}
      />
    </ul>,
  );
  await expect.element(row("Top.md")).toBeInTheDocument();
  await expect.element(row("Plan.md")).toBeInTheDocument();
  await userEvent.click(row("Top.md"));
  expect(done.open).toHaveBeenCalledWith("Top.md", expect.anything());
});

it("leaves a Cmd-click to the selection, and takes Enter as a click", async () => {
  const done = actions();
  await using _screen = await render(
    <ul>
      <WikiDocumentTree
        documents={[item("One.md"), item("Two.md")]}
        outsideFilter={null}
        focusedFile={null}
        actions={done}
      />
    </ul>,
  );
  await expect.element(row("One.md")).toBeInTheDocument();
  await userEvent.keyboard("{Meta>}");
  await userEvent.click(row("One.md"));
  await userEvent.keyboard("{/Meta}");
  expect(done.open).not.toHaveBeenCalled();
  await userEvent.click(row("Two.md"));
  expect(done.open).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Enter}");
  expect(done.open).toHaveBeenLastCalledWith("Two.md", null);
});

it("renames a document and a folder with F2, and a refused move puts the row back", async () => {
  const done = actions();
  await using _screen = await render(
    <ul>
      <WikiDocumentTree
        documents={[item("a/Plan.md"), item("Top.md")]}
        outsideFilter={null}
        focusedFile="Top.md"
        actions={{
          ...done,
          move: async (from, to, folder) => {
            await done.move(from, to, folder);
            return false;
          },
        }}
      />
    </ul>,
  );
  await expect.element(row("Top.md")).toBeInTheDocument();
  await userEvent.click(row("Top.md"));
  await userEvent.keyboard("{F2}");
  await userEvent.keyboard("{Home}{Shift>}{End}{/Shift}Next.md{Enter}");
  await vi.waitFor(() => expect(done.move).toHaveBeenCalledWith("Top.md", "Next.md", false));
  await expect.element(row("Top.md")).toBeInTheDocument();
  await userEvent.click(row("a"));
  await userEvent.keyboard("{F2}");
  await userEvent.keyboard("{Home}{Shift>}{End}{/Shift}z{Enter}");
  await vi.waitFor(() => expect(done.move).toHaveBeenCalledWith("a", "z", true));
});
