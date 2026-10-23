import { createFileRoute } from "@tanstack/react-router";

import { RepositoryWorkspace } from "../components/repositories/RepositoryWorkspace";

/** Astrolabe: the Repositories section: a repository's files and changes in tabs. */
export const Route = createFileRoute("/_chat/repositories")({
  component: RepositoryWorkspace,
});
