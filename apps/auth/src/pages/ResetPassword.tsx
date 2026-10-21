import { type FormEvent, useState } from "react";

import { authClient, errorMessage } from "../auth";
import { navigate } from "../router";
import { Button, CodeField, Field, Heading, Link, Notice } from "../ui";
import { PATHS } from "../paths";

/**
 * Resetting a password with an emailed code. It also sets a first password
 * for an account that has only signed in with codes, providers or passkeys.
 */
export function ResetPassword(props: { readonly email: string | null }) {
  const [email, setEmail] = useState(props.email ?? "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.requestPasswordReset({ email });
    setBusy(false);
    if (error) return setError(errorMessage(error, "We couldn't send a code. Try again."));
    setSent(true);
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.resetPassword({ email, otp: code, password });
    setBusy(false);
    if (error) return setError(errorMessage(error, "We couldn't change your password."));
    navigate(`${PATHS.signIn}?reset=1`, { replace: true });
  };

  if (!sent) {
    return (
      <>
        <Heading title="Reset your password">
          We'll email you a code to choose a new password.
        </Heading>
        <form className="flex flex-col gap-4" onSubmit={(event) => void request(event)}>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" busy={busy}>
            Email me a code
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          <Link to={PATHS.signIn}>Back to sign in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <Heading title="Choose a new password">
        Enter the code we sent to <strong className="text-text">{email}</strong>.
      </Heading>
      <form className="flex flex-col gap-4" onSubmit={(event) => void reset(event)}>
        <CodeField value={code} onChange={setCode} />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint="At least 10 characters."
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" busy={busy} disabled={code.length !== 6}>
          Change password
        </Button>
      </form>
    </>
  );
}
