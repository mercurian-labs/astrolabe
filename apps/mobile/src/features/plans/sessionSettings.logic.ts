import type { RuntimeMode } from "@t3tools/contracts";

export function codingSessionRuntimeModeChoices<T extends { readonly mode: RuntimeMode }>(
  choices: ReadonlyArray<T>,
  currentMode: RuntimeMode,
  codingSession: boolean,
): ReadonlyArray<T> {
  if (!codingSession) return choices;
  const sessionChoices = choices.filter((choice) => choice.mode !== "auto");
  const legacyCurrent = choices.find(
    (choice) => choice.mode === "auto" && choice.mode === currentMode,
  );
  return legacyCurrent === undefined ? sessionChoices : [...sessionChoices, legacyCurrent];
}
