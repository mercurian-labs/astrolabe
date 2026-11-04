import { EnvironmentId, ProjectId, WikiId, type WikiSummary } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { WikiProjectLinks } from "./WikiLinks";

const state = vi.hoisted(() => ({
  link: (() => undefined) as (value: unknown) => void,
  projects: [] as ReadonlyArray<{ environmentId: string; id: string; title: string }>,
}));

vi.mock("../repositories/useRepositories", () => ({
  useRepositories: () => state.projects,
}));
vi.mock("~/state/wiki", () => ({
  wikiEnvironment: { setProjectLink: { permissionAtom: () => Atom.make(true) } },
}));
vi.mock("./wikiEnvironment", () => ({
  useWikiCommand: () => async (value: unknown) => {
    state.link(value);
    return { ok: true, value: null };
  },
  useWikiOverviews: () => ({ overviews: [], loading: false }),
}));

const environmentId = EnvironmentId.make("laptop");
const astrolabe = ProjectId.make("astrolabe");
const t3code = ProjectId.make("t3code");
const wiki: WikiSummary = {
  wikiId: WikiId.make("almagest"),
  name: "almagest",
  root: "/dev/almagest",
  mainBranch: "main",
  projectIds: [astrolabe],
  mirror: null,
  openChangeRequests: 0,
  createdAt: "2026-11-03T00:00:00.000Z",
};

function setup() {
  const link = vi.fn();
  state.link = link;
  state.projects = [
    { environmentId, id: astrolabe, title: "astrolabe" },
    { environmentId, id: ProjectId.make("old-scratch"), title: "No project" },
    { environmentId, id: t3code, title: "t3code" },
    { environmentId: "phone", id: ProjectId.make("elsewhere"), title: "elsewhere" },
  ];
  return { link };
}

it("shows what a link does, unlinks it, and offers only the projects a wiki can link to", async () => {
  const { link } = setup();
  await using screen = await render(<WikiProjectLinks environmentId={environmentId} wiki={wiki} />);

  await expect
    .element(screen.getByText("Agents in astrolabe search this wiki first", { exact: false }))
    .toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
  expect(link).toHaveBeenLastCalledWith({
    environmentId,
    input: { wikiId: wiki.wikiId, projectId: astrolabe, linked: false },
  });

  await userEvent.click(screen.getByText("Link a project"));
  const choice = page.getByRole("option", { name: "t3code" });
  await expect.element(choice).toBeVisible();
  expect(
    page
      .getByRole("option")
      .elements()
      .map((option) => option.textContent),
  ).toEqual(["t3code"]);
  await userEvent.click(choice);
  expect(link).toHaveBeenLastCalledWith({
    environmentId,
    input: { wikiId: wiki.wikiId, projectId: t3code, linked: true },
  });
});
