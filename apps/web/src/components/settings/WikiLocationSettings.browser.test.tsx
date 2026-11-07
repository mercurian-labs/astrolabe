import { DEFAULT_WIKI_LOCATION_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { WikiLocationSettings } from "./WikiLocationSettings";

const state = vi.hoisted(() => ({
  update: (() => undefined) as (patch: unknown) => void,
}));

vi.mock("~/hooks/useSettings", async (original) => ({
  ...(await original<typeof import("~/hooks/useSettings")>()),
  useEnvironmentSettings: (_environment: unknown, select: (settings: unknown) => unknown) =>
    select({
      wikiLocations: { ...DEFAULT_WIKI_LOCATION_SETTINGS, newNotes: "folder", newNoteFolder: "" },
    }),
  useUpdateEnvironmentSettings: () => state.update,
}));

const environmentId = EnvironmentId.make("laptop");

function setup() {
  const update = vi.fn();
  state.update = update;
  return { update };
}

const saved = (update: ReturnType<typeof vi.fn>) =>
  update.mock.calls.map(([patch]) => patch.wikiLocations.newNoteFolder);

it("saves a folder as it's typed, with nothing to press or leave", async () => {
  const { update } = setup();
  await using screen = await render(
    <WikiLocationSettings environmentId={environmentId} serverLabel={null} />,
  );
  await userEvent.type(screen.getByLabelText("New note folder"), "b{Enter}");
  expect(saved(update)).toEqual(["b"]);
});

it("says why a folder is refused, and doesn't save it", async () => {
  const { update } = setup();
  await using screen = await render(
    <WikiLocationSettings environmentId={environmentId} serverLabel={null} />,
  );
  await userEvent.fill(screen.getByLabelText("New note folder"), "../x");
  await expect.element(screen.getByText(/isn't saved/)).toBeVisible();
  expect(saved(update)).toEqual([]);
});
