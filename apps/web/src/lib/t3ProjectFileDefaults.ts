import {
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectReadFileResult,
  type T3ProjectFile,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";

import { getProjectFileQueryAtom } from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

function toT3ProjectFile(data: ProjectReadFileResult | null): T3ProjectFile | null {
  if (data === null || data.exists === false || data.truncated) return null;
  return parseT3ProjectFile(data.contents);
}

export async function readT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<T3ProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  return toT3ProjectFile(result._tag === "Success" ? result.value : null);
}

/** The project's t3.json from an earlier read, or `undefined` when none has loaded yet. */
export function peekT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): T3ProjectFile | null | undefined {
  const result = appAtomRegistry.get(
    getProjectFileQueryAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME),
  );
  return AsyncResult.isSuccess(result) ? toT3ProjectFile(result.value) : undefined;
}
