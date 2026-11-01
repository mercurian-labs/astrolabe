import type { WorkspaceSync } from "@t3tools/client-runtime/workspaces";
import type { MemberRow, WorkspaceRow } from "@t3tools/shared/mercurianWorkspaces";
import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const mocks = vi.hoisted(() => ({ sync: null as unknown }));
vi.mock("../../cloud/account", () => ({
  startCloudSignIn: () => undefined,
  useCloudAccountState: () => ({
    status: "signedIn",
    user: { id: "me", name: "Me", email: "me@example.com", image: null, access: "approved" },
  }),
}));
vi.mock("../../cloud/workspaces", () => ({ useWorkspaceSync: () => mocks.sync }));

const workspace = (id: string, name: string): WorkspaceRow => ({
  id,
  name,
  slug: id,
  logo: null,
  created_at: "2026-11-01",
  invite_policy: null,
  team_creation_policy: null,
});
const member = (id: string, org: string, role: MemberRow["role"]): MemberRow => ({
  id,
  organization_id: org,
  user_id: "me",
  role,
  created_at: "2026-11-01",
});

/** Real collections holding Acme (which you own) and Beta (where you're a member). */
function setup() {
  window.localStorage.removeItem("astrolabe:selected-workspace:me");
  const members = createCollection(
    localOnlyCollectionOptions<MemberRow>({
      getKey: (row) => row.id,
      initialData: [member("m-acme", "acme", "owner"), member("m-beta", "beta", "member")],
    }),
  );
  const workspaces = createCollection(
    localOnlyCollectionOptions<WorkspaceRow>({
      getKey: (row) => row.id,
      initialData: [workspace("acme", "Acme"), workspace("beta", "Beta")],
    }),
  );
  mocks.sync = { userId: "me", collections: { workspaces, members } } as unknown as WorkspaceSync;
  return { members };
}

const tile = (name: string) => page.getByRole("button", { name, exact: true });

async function choose(current: string, option: string) {
  await userEvent.click(tile(current));
  await userEvent.click(page.getByRole("menuitemradio", { name: option }));
}

describe("WorkspaceSwitcher", () => {
  it("keeps the chosen workspace across a remount, and goes back to none", async () => {
    setup();
    {
      await using _screen = await render(<WorkspaceSwitcher />);
      await choose("Workspaces", "Beta");
      await expect.element(tile("Workspace: Beta")).toBeVisible();
    }
    await using _screen = await render(<WorkspaceSwitcher />);
    await expect.element(tile("Workspace: Beta")).toBeVisible();
    await choose("Workspace: Beta", "No workspace");
    await expect.element(tile("Workspaces")).toBeVisible();
  });

  it("falls back to none when you leave the selected workspace", async () => {
    const { members } = setup();
    await using _screen = await render(<WorkspaceSwitcher />);
    await choose("Workspaces", "Acme");
    await expect.element(tile("Workspace: Acme")).toBeVisible();
    await act(() => members.delete("m-acme"));
    await expect.element(tile("Workspaces")).toBeVisible();
  });

  it("offers Invite people only where your role may invite", async () => {
    setup();
    await using _screen = await render(<WorkspaceSwitcher />);
    await choose("Workspaces", "Acme");
    await userEvent.click(tile("Workspace: Acme"));
    await expect.element(page.getByRole("menuitem", { name: "Invite people" })).toBeVisible();
    await userEvent.click(page.getByRole("menuitemradio", { name: "Beta" }));
    await userEvent.click(tile("Workspace: Beta"));
    await expect.element(page.getByRole("menuitem", { name: "Workspace settings" })).toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Invite people" }))
      .not.toBeInTheDocument();
  });
});
