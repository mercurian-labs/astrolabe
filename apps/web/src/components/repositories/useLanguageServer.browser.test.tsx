import { RegistryContext } from "@effect/atom-react";
import type { DocumentSession } from "@t3tools/client-runtime/state/document-session";
import {
  type EnvironmentId,
  type LanguageServerRoute,
  type LanguageServerRoutes,
  languageServerToolchain,
} from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const shared = vi.hoisted(() => ({
  routes: null as unknown,
  destroyed: [] as Array<string>,
  followed: [] as Array<string>,
}));

vi.mock(import("~/state/languageServers"), async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    languageServersEnvironment: {
      routes: () => shared.routes,
      sender: () => () => undefined,
      session: (_environmentId: string, target: { readonly server: string }) => {
        shared.followed.push(target.server);
        return Atom.make(null);
      },
    } as never,
  };
});
vi.mock(import("@mercurian/editor/lsp"), async () => ({
  environmentLsp: ((options: { readonly languageId: string }) => ({
    extension: [],
    connect: () => undefined,
    reset: () => undefined,
    receive: () => undefined,
    destroy: () => shared.destroyed.push(options.languageId),
  })) as never,
}));
vi.mock(import("./languageServerFile"), async () => {
  const { Facet } = await import("@codemirror/state");
  return { languageServerFile: Facet.define() as never } as never;
});

import { act, render } from "../../../test/render";
import { useLanguageServer } from "./useLanguageServer";

const route = (server: LanguageServerRoute["server"], languageId: string): LanguageServerRoute => ({
  server,
  name: server,
  languageId,
  off: false,
  toolchain: languageServerToolchain(server),
});

const hosts = { openLogs: () => undefined, openSettings: null };

function Harness({ path }: { readonly path: string }) {
  const { file } = useLanguageServer(
    "env" as EnvironmentId,
    "/repo",
    path,
    {} as DocumentSession,
    true,
    hosts,
  );
  return <span data-testid="server">{file?.server ?? "none"}</span>;
}

/** A file's editor, on routes the test can change as the environment would. */
async function setup(path: string) {
  shared.destroyed.length = 0;
  shared.followed.length = 0;
  const registry = AtomRegistry.make();
  const routes = Atom.make<AsyncResult.AsyncResult<LanguageServerRoutes>>(AsyncResult.initial());
  shared.routes = routes;
  const screen = await render(
    <RegistryContext.Provider value={registry}>
      <Harness path={path} />
    </RegistryContext.Provider>,
  );
  return {
    screen,
    server: screen.getByTestId("server"),
    arrive: (extensions: LanguageServerRoutes["extensions"]) =>
      act(() => registry.set(routes, AsyncResult.success({ extensions }))),
  };
}

it("runs the usual servers until told, and hearing the same binds nothing new", async () => {
  const { screen, server, arrive } = await setup("src/main.ts");
  await using _screen = screen;
  await expect.element(server).toHaveTextContent("typescript");
  await arrive({ ts: [route("typescript", "typescript"), route("eslint", "typescript")] });
  await expect.element(server).toHaveTextContent("typescript");
  expect(shared.followed).toEqual(["typescript"]);
  expect(shared.destroyed).toEqual([]);
});

it("moves an open file to the server settings put on it, ending the old client", async () => {
  const { screen, server, arrive } = await setup("src/main.py");
  await using _screen = screen;
  await arrive({ py: [route("basedpyright", "python")] });
  await arrive({ py: [route("custom:mine", "mypython"), route("basedpyright", "python")] });
  await expect.element(server).toHaveTextContent("custom:mine");
  expect(shared.followed).toEqual(["basedpyright", "custom:mine"]);
  expect(shared.destroyed).toEqual(["python"]);
});

it("gives a file nothing built-in reads a server once one is set up, and takes it away", async () => {
  const { screen, server, arrive } = await setup("src/app.foo");
  await using _screen = screen;
  await expect.element(server).toHaveTextContent("none");
  await arrive({ foo: [route("custom:mine", "foolang")] });
  await expect.element(server).toHaveTextContent("custom:mine");
  await arrive({});
  await expect.element(server).toHaveTextContent("none");
  expect(shared.destroyed).toEqual(["foolang"]);
});

it("skips a server turned off, and shows the first when every one is off", async () => {
  const { screen, server, arrive } = await setup("src/main.py");
  await using _screen = screen;
  const pyright = route("basedpyright", "python");
  const ruff = route("ruff", "python");
  await arrive({ py: [{ ...pyright, off: true }, ruff] });
  await expect.element(server).toHaveTextContent("ruff");
  await arrive({
    py: [
      { ...pyright, off: true },
      { ...ruff, off: true },
    ],
  });
  await expect.element(server).toHaveTextContent("basedpyright");
});
