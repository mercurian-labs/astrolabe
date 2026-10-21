import { startCloudSignIn } from "../../cloud/account";

export function useT3ConnectAuthPrompt() {
  return { authPrompt: null, openAuthPrompt: startCloudSignIn };
}
