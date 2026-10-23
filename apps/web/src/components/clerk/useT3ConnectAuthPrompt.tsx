import { startCloudSignIn } from "../../cloud/account";

/** Astrolabe: T3 Connect's sign-in prompt is the device-code sign-in, so it calls no hooks. */
export function t3ConnectAuthPrompt() {
  return { authPrompt: null, openAuthPrompt: startCloudSignIn };
}
