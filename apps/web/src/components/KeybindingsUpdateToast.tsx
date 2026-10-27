import { appAtomRegistry, subscribeAtomChanges } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { primaryServerConfigAtom, primaryServerConfigEventAtom } from "../state/server";
import { KeybindingsConfigWarning } from "./KeybindingsConfigWarning";
import { createKeybindingsUpdateToastController } from "./KeybindingsUpdateToast.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

/** Toasts each keybindings reload the primary server reports. */
export function startKeybindingsUpdateToasts(): () => void {
  const controller = createKeybindingsUpdateToastController({});
  return subscribeAtomChanges(primaryServerConfigEventAtom, (event) => {
    const decision = controller.handle(event);
    if (!decision) return;

    if (decision._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Keybindings updated",
        description: "Keybindings configuration reloaded successfully.",
      });
      return;
    }

    // Astrolabe: the vimrc's own reload and warning, which open the vimrc.
    if (decision._tag === "VimrcSuccess") {
      toastManager.add({
        type: "success",
        title: "Vim configuration updated",
        description: "The vimrc reloaded.",
      });
      return;
    }

    const serverConfig = appAtomRegistry.get(primaryServerConfigAtom);
    if (decision._tag === "InvalidVimrc") {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Vim configuration has lines it cannot apply",
          description: (
            <KeybindingsConfigWarning
              message={decision.message}
              environmentId={appAtomRegistry.get(primaryEnvironmentIdAtom)}
              configPath={serverConfig?.vimrcConfigPath ?? null}
              availableEditors={serverConfig?.availableEditors ?? []}
              fileName="vimrc"
            />
          ),
        }),
      );
      return;
    }

    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: (
          <KeybindingsConfigWarning
            message={decision.message}
            environmentId={appAtomRegistry.get(primaryEnvironmentIdAtom)}
            configPath={serverConfig?.keybindingsConfigPath ?? null}
            availableEditors={serverConfig?.availableEditors ?? []}
          />
        ),
      }),
    );
  });
}
