import type { Mail } from "./Mailer.ts";

const signature = "\n\nIf you didn't ask for this, you can ignore this email.\n\nAstrolabe";

export type CodePurpose =
  | "sign-in"
  | "email-verification"
  | "forget-password"
  | "change-email"
  | "two-factor";

const codeSubjects: Record<CodePurpose, string> = {
  "sign-in": "is your Astrolabe sign-in code",
  "email-verification": "is your Astrolabe verification code",
  "forget-password": "is your Astrolabe password reset code",
  "change-email": "is your code to change your Astrolabe email",
  "two-factor": "is your Astrolabe sign-in code",
};

/** A one-time code. The code leads the subject so it shows in notification previews. */
export const codeMail = (to: string, code: string, purpose: CodePurpose): Mail => ({
  to,
  subject: `${code} ${codeSubjects[purpose]}`,
  text: `Your code is ${code}. It expires in 5 minutes.${signature}`,
});

export const invitationMail = (input: {
  readonly to: string;
  readonly inviterName: string;
  readonly organizationName: string;
  readonly url: string;
}): Mail => ({
  to: input.to,
  subject: `${input.inviterName} invited you to ${input.organizationName} on Astrolabe`,
  text: `${input.inviterName} invited you to join ${input.organizationName} on Astrolabe.\n\nAccept the invitation: ${input.url}${signature}`,
});

export const approvedMail = (to: string, signInUrl: string): Mail => ({
  to,
  subject: "You're in: your Astrolabe account is ready",
  text: `You're off the waitlist. Sign in to start: ${signInUrl}\n\nAstrolabe`,
});
