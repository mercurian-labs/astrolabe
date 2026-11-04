import { EnvironmentId, WikiId, type WikiSummary } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { WikiMapBackgrounds } from "./WikiMapBackgrounds";

const state = vi.hoisted(() => ({
  write: (() => undefined) as (value: unknown) => void,
}));

vi.mock("~/state/wiki", () => ({
  wikiEnvironment: { setMapBackgrounds: { permissionAtom: () => Atom.make(true) } },
}));
vi.mock("../wiki/wikiEnvironment", () => ({
  useWikiCommand: () => async (value: unknown) => {
    state.write(value);
    return { ok: true, value: null };
  },
}));

const environmentId = EnvironmentId.make("laptop");
const terrain = { name: "Terrain", lightTiles: "https://a/?key=secret", darkTiles: null };
const satellite = { name: "Satellite", lightTiles: "https://b/light", darkTiles: "https://b/dark" };
const wiki: WikiSummary = {
  wikiId: WikiId.make("almagest"),
  name: "almagest",
  root: "/dev/almagest",
  mainBranch: "main",
  projectIds: [],
  mirror: null,
  mapBackgrounds: [terrain, satellite],
  openChangeRequests: 0,
  createdAt: "2026-11-03T00:00:00.000Z",
};

function setup() {
  const write = vi.fn();
  state.write = write;
  return { write };
}

const written = (backgrounds: ReadonlyArray<unknown>) => ({
  environmentId,
  input: { wikiId: wiki.wikiId, backgrounds },
});

it("adds a background to the end of the list, with no dark tiles when left blank", async () => {
  const { write } = setup();
  await using screen = await render(
    <WikiMapBackgrounds environmentId={environmentId} wiki={wiki} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Add background" }));
  await userEvent.fill(screen.getByLabelText("Name"), "  Streets ");
  await userEvent.fill(screen.getByLabelText("Light mode"), "https://c/{z}/{x}/{y}.png");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(write).toHaveBeenCalledWith(
    written([
      terrain,
      satellite,
      { name: "Streets", lightTiles: "https://c/{z}/{x}/{y}.png", darkTiles: null },
    ]),
  );
  await expect.element(screen.getByLabelText("Name")).not.toBeInTheDocument();
});

it("edits a background, makes one the default and removes one", async () => {
  const { write } = setup();
  await using screen = await render(
    <WikiMapBackgrounds environmentId={environmentId} wiki={wiki} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Make default" }));
  expect(write).toHaveBeenLastCalledWith(written([satellite, terrain]));

  await userEvent.click(screen.getByRole("button", { name: "Remove" }).first());
  expect(write).toHaveBeenLastCalledWith(written([satellite]));

  await userEvent.click(screen.getByRole("button", { name: "Edit" }).nth(1));
  await userEvent.fill(screen.getByLabelText("Dark mode (optional)"), "");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(write).toHaveBeenLastCalledWith(written([terrain, { ...satellite, darkTiles: null }]));
});

it("shows names only, since an address can hold a key", async () => {
  setup();
  await using screen = await render(
    <WikiMapBackgrounds environmentId={environmentId} wiki={wiki} />,
  );

  await expect.element(screen.getByText("Terrain")).toBeVisible();
  expect(screen.container.textContent).not.toContain("secret");
});
