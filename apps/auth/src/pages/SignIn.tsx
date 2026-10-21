import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { authClient, errorMessage } from "../auth";
import { pageConfig, safeReturnUrl, type SocialProvider } from "../config";
import { navigate, withReturn } from "../router";
import { Button, CodeField, Divider, Field, Heading, Link, Notice } from "../ui";
import { PATHS } from "../paths";

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
};

type Step =
  | { readonly kind: "start" }
  | { readonly kind: "password" }
  | { readonly kind: "code"; readonly email: string }
  | { readonly kind: "verify-email"; readonly email: string }
  | { readonly kind: "two-factor" };

/**
 * Signing in and signing up are one page. A provider or an emailed code signs
 * in, creating a waitlisted account the first time; the code proves the
 * address before any account exists. A passkey or a password signs in an
 * existing account, and only a password asks for a second step (an emailed
 * code, or an authenticator code), as the server requires.
 */
export function SignIn(props: { readonly returnTo: string | null }) {
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [error, setError] = useState<string | null>(null);
  const done = useCallback(
    () => navigate(safeReturnUrl(props.returnTo), { replace: true }),
    [props.returnTo],
  );
  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  switch (step.kind) {
    case "start":
      return (
        <StartStep
          returnTo={props.returnTo}
          error={error}
          setError={setError}
          onCodeSent={(email) => go({ kind: "code", email })}
          onPassword={() => go({ kind: "password" })}
          onSignedIn={done}
        />
      );
    case "password":
      return (
        <PasswordStep
          returnTo={props.returnTo}
          error={error}
          setError={setError}
          onBack={() => go({ kind: "start" })}
          onTwoFactor={() => go({ kind: "two-factor" })}
          onUnverified={(email) => go({ kind: "verify-email", email })}
          onSignedIn={done}
        />
      );
    case "code":
      return (
        <EmailCodeStep
          email={step.email}
          purpose="sign-in"
          onBack={() => go({ kind: "start" })}
          onSignedIn={done}
        />
      );
    case "verify-email":
      return (
        <EmailCodeStep
          email={step.email}
          purpose="email-verification"
          onBack={() => go({ kind: "password" })}
          onSignedIn={done}
        />
      );
    case "two-factor":
      return <TwoFactorStep onBack={() => go({ kind: "password" })} onSignedIn={done} />;
  }
}

function StartStep(props: {
  readonly returnTo: string | null;
  readonly error: string | null;
  readonly setError: (error: string | null) => void;
  readonly onCodeSent: (email: string) => void;
  readonly onPassword: () => void;
  readonly onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const returnUrl = safeReturnUrl(props.returnTo);
  const absoluteReturn = new URL(returnUrl, window.location.origin).toString();

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("email");
    props.setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setBusy(null);
    if (error) return props.setError(errorMessage(error, "We couldn't send a code. Try again."));
    props.onCodeSent(email);
  };

  const passkey = async () => {
    setBusy("passkey");
    props.setError(null);
    const { error } = await authClient.signIn.passkey();
    setBusy(null);
    if (error) return props.setError(errorMessage(error, "That passkey didn't work. Try again."));
    props.onSignedIn();
  };

  // Passkeys are offered in the email field's autofill, where the browser
  // supports it. The request waits until a passkey is picked; starting the
  // "Use a passkey" ceremony cancels it, so its errors are never shown.
  const { onSignedIn } = props;
  useEffect(() => {
    void (async () => {
      if (!(await window.PublicKeyCredential?.isConditionalMediationAvailable?.())) return;
      const { error } = await authClient.signIn.passkey({ autoFill: true });
      if (!error) onSignedIn();
    })();
  }, [onSignedIn]);

  const social = async (provider: SocialProvider) => {
    setBusy(provider);
    props.setError(null);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: absoluteReturn,
      errorCallbackURL: new URL(
        withReturn(PATHS.signIn, props.returnTo),
        window.location.origin,
      ).toString(),
    });
    // On success the browser is already leaving for the provider.
    if (error) {
      setBusy(null);
      props.setError(errorMessage(error, `Couldn't reach ${PROVIDER_LABELS[provider]}.`));
    }
  };

  return (
    <>
      <p className="-mt-4 mb-8 text-center text-sm text-muted">
        Sign in, or sign up to join the waitlist.
      </p>
      {pageConfig.providers.length > 0 ? (
        <>
          <div className="flex flex-col gap-2">
            {pageConfig.providers.map((provider) => (
              <Button
                key={provider}
                variant="secondary"
                busy={busy === provider}
                onClick={() => void social(provider)}
              >
                Continue with {PROVIDER_LABELS[provider]}
              </Button>
            ))}
          </div>
          <Divider label="or use your email" />
        </>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={(event) => void sendCode(event)}>
        <Field
          label="Email"
          type="email"
          autoComplete="email webauthn"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {props.error ? <Notice tone="error">{props.error}</Notice> : null}
        <Button type="submit" busy={busy === "email"}>
          Continue with email
        </Button>
      </form>
      <div className="mt-6 flex justify-center gap-6 text-sm text-muted">
        <button
          type="button"
          className="hover:text-text disabled:opacity-60"
          disabled={busy === "passkey"}
          onClick={() => void passkey()}
        >
          Use a passkey
        </button>
        <button type="button" className="hover:text-text" onClick={props.onPassword}>
          Use a password
        </button>
      </div>
    </>
  );
}

function PasswordStep(props: {
  readonly returnTo: string | null;
  readonly error: string | null;
  readonly setError: (error: string | null) => void;
  readonly onBack: () => void;
  readonly onTwoFactor: () => void;
  readonly onUnverified: (email: string) => void;
  readonly onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    props.setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error?.code === "EMAIL_NOT_VERIFIED") {
      await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
      return props.onUnverified(email);
    }
    if (error) return props.setError(errorMessage(error, "That email and password don't match."));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return props.onTwoFactor();
    props.onSignedIn();
  };

  return (
    <>
      <Heading title="Sign in with a password" />
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={
            <Link
              to={`${PATHS.resetPassword}${email ? `?email=${encodeURIComponent(email)}` : ""}`}
            >
              Forgot your password?
            </Link>
          }
        />
        {props.error ? <Notice tone="error">{props.error}</Notice> : null}
        <Button type="submit" busy={busy}>
          Sign in
        </Button>
        <Button variant="ghost" onClick={props.onBack}>
          Other ways to sign in
        </Button>
      </form>
    </>
  );
}

/** Enter a code we emailed: to sign in (or up), or to confirm the address of a password account. */
export function EmailCodeStep(props: {
  readonly email: string;
  readonly purpose: "sign-in" | "email-verification";
  readonly onBack: () => void;
  readonly onSignedIn: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } =
      props.purpose === "sign-in"
        ? await authClient.signIn.emailOtp({ email: props.email, otp: code })
        : await authClient.emailOtp.verifyEmail({ email: props.email, otp: code });
    setBusy(false);
    if (error)
      return setError(errorMessage(error, "That code didn't work. Check it and try again."));
    props.onSignedIn();
  };

  const resend = async () => {
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: props.email,
      type: props.purpose,
    });
    if (error) return setError(errorMessage(error, "We couldn't send another code."));
    setResent(true);
  };

  return (
    <>
      <Heading title="Check your email">
        We sent a six-digit code to <strong className="text-text">{props.email}</strong>.
      </Heading>
      <form className="flex flex-col gap-4" onSubmit={(event) => void verify(event)}>
        <CodeField value={code} onChange={setCode} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {resent && !error ? <Notice>We sent a new code.</Notice> : null}
        <Button type="submit" busy={busy} disabled={code.length !== 6}>
          {props.purpose === "sign-in" ? "Continue" : "Confirm email"}
        </Button>
        <div className="flex justify-between text-sm">
          <Button variant="ghost" onClick={props.onBack}>
            Use a different email
          </Button>
          <Button variant="ghost" onClick={() => void resend()}>
            Send a new code
          </Button>
        </div>
      </form>
    </>
  );
}

type SecondStepMethod = "email" | "authenticator" | "backup";

function TwoFactorStep(props: { readonly onBack: () => void; readonly onSignedIn: () => void }) {
  const [method, setMethod] = useState<SecondStepMethod>("email");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendEmailCode = async () => {
    setError(null);
    const { error } = await authClient.twoFactor.sendOtp();
    if (error) setError(errorMessage(error, "We couldn't send a code."));
  };

  // One code per visit: a second send would replace the first while it's in the inbox.
  const autoSent = useRef(false);
  useEffect(() => {
    if (method !== "email" || autoSent.current) return;
    autoSent.current = true;
    void sendEmailCode();
  }, [method]);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } =
      method === "email"
        ? await authClient.twoFactor.verifyOtp({ code, trustDevice })
        : method === "authenticator"
          ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
          : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
    setBusy(false);
    if (error) return setError(errorMessage(error, "That code didn't work. Try again."));
    props.onSignedIn();
  };

  const choose = (next: SecondStepMethod) => {
    setCode("");
    setError(null);
    setMethod(next);
  };

  return (
    <>
      <Heading title="One more step">
        {method === "email"
          ? "We emailed you a six-digit code to finish signing in."
          : method === "authenticator"
            ? "Enter the code from your authenticator app."
            : "Enter one of your backup codes."}
      </Heading>
      <form className="flex flex-col gap-4" onSubmit={(event) => void verify(event)}>
        {method === "backup" ? (
          <Field
            label="Backup code"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
          />
        ) : (
          <CodeField value={code} onChange={setCode} />
        )}
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(event) => setTrustDevice(event.target.checked)}
          />
          Trust this device for 30 days
        </label>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" busy={busy} disabled={method !== "backup" && code.length !== 6}>
          Continue
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-1 text-sm text-muted">
        {method !== "email" ? (
          <button type="button" className="hover:text-text" onClick={() => choose("email")}>
            Email me a code instead
          </button>
        ) : (
          <button type="button" className="hover:text-text" onClick={() => void sendEmailCode()}>
            Send a new code
          </button>
        )}
        {method !== "authenticator" ? (
          <button type="button" className="hover:text-text" onClick={() => choose("authenticator")}>
            Use an authenticator app
          </button>
        ) : null}
        {method !== "backup" ? (
          <button type="button" className="hover:text-text" onClick={() => choose("backup")}>
            Use a backup code
          </button>
        ) : null}
        <button type="button" className="hover:text-text" onClick={props.onBack}>
          Back
        </button>
      </div>
    </>
  );
}
