import { MercurianRepositoryId, type MercurianRepository } from "@t3tools/contracts";
import type { PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MercurianRepositoriesState } from "../../state/mercurianRepositories";

const repositoryState = vi.hoisted(() => ({
  current: {
    snapshot: { repositories: [], projectRepositories: [] },
    isPending: false,
    error: null,
  } as MercurianRepositoriesState,
}));

vi.mock("../../projectScopeStore", () => ({
  useProjectScopeStore: (
    selector: (state: {
      readonly projectScopeId: string | null;
      readonly setProjectScope: (id: string | null) => void;
    }) => unknown,
  ) => selector({ projectScopeId: null, setProjectScope: vi.fn() }),
}));

vi.mock("../../state/mercurian", () => ({
  useCreateMercurianProject: () => vi.fn(),
}));

vi.mock("../../state/mercurianRepositories", () => ({
  useAddRepository: () => vi.fn(),
  useRepositories: () => repositoryState.current,
  useSetProjectRepositories: () => vi.fn(),
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironment: () => null,
  usePrimaryEnvironmentId: () => null,
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));

vi.mock("../ui/dialog", () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <footer>{children}</footer>,
  DialogHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
  DialogPanel: ({ children }: PropsWithChildren) => <section>{children}</section>,
  DialogPopup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

import { NewProjectDialog } from "./NewProjectDialog";

const repository = (repositoryId: string, name: string, path: string): MercurianRepository => ({
  repositoryId: MercurianRepositoryId.make(repositoryId),
  name,
  path,
  hasGit: true,
  hosting: null,
  scripts: [],
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
});

function renderDialog() {
  return renderToStaticMarkup(<NewProjectDialog open onOpenChange={vi.fn()} />);
}

describe("NewProjectDialog repository states", () => {
  beforeEach(() => {
    repositoryState.current = {
      snapshot: { repositories: [], projectRepositories: [] },
      isPending: false,
      error: null,
    };
  });

  it("renders sorted, unchecked repository rows when the registry has repositories", () => {
    repositoryState.current = {
      snapshot: {
        repositories: [
          repository("repo-z", "Zulu", "/code/zulu"),
          repository("repo-a", "Astrolabe", "/code/astrolabe"),
        ],
        projectRepositories: [],
      },
      isPending: false,
      error: null,
    };

    const markup = renderDialog();

    expect(markup.indexOf("Astrolabe")).toBeLessThan(markup.indexOf("Zulu"));
    expect(markup).toContain("/code/astrolabe");
    expect(markup).toContain("/code/zulu");
    expect(markup.match(/aria-checked="false"/g)).toHaveLength(2);
    expect(markup).not.toContain('aria-checked="true"');
    expect(markup).not.toContain("Pick a local folder");
  });

  it("renders the add-repository mode picker when the registry is empty", () => {
    const markup = renderDialog();

    expect(markup).toContain("Pick a local folder");
    expect(markup).toContain("Clone a git URL");
    expect(markup.match(/<footer>/g)).toHaveLength(1);
    expect(markup).toMatch(/<footer>[\s\S]*Create[\s\S]*<\/footer>/);
  });

  it("renders neither repository branch while the snapshot is pending", () => {
    repositoryState.current = {
      snapshot: {
        repositories: [repository("repo-a", "Astrolabe", "/code/astrolabe")],
        projectRepositories: [],
      },
      isPending: true,
      error: null,
    };

    const markup = renderDialog();

    expect(markup).toContain("Loading repositories…");
    expect(markup).not.toContain("Astrolabe");
    expect(markup).not.toContain("Pick a local folder");
  });
});
