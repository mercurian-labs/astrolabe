import { type FormEvent, useEffect, useState } from "react";

import { authClient, errorMessage } from "../auth";
import { navigate } from "../router";
import { Button, Field, Heading, Notice, Spinner } from "../ui";
import { PATHS } from "../paths";

/**
 * Names the app asking to sign in from its client id, so a code someone else
 * forwarded reads as a stranger's request. Ids come from the clients: see
 * packages/shared/src/mercurianAccount.ts and the CLI's CliTokenManager.
 */
export function describeClient(clientId: string | null): string {
  if (clientId === "astrolabe-cli") return "Astrolabe's command line";
  if (clientId === "astrolabe-desktop") return "Astrolabe for desktop";
  if (clientId === "astrolabe-mobile") return "Astrolabe on a phone";
  if (clientId?.startsWith("astrolabe-web:")) {
    return `Astrolabe at ${clientId.slice("astrolabe-web:".length)}`;
  }
  return "An app";
}

type Request =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "found";
      readonly status: string;
      readonly clientId: string | null;
    };

/**
 * Approving a device sign-in. Every client but the hosted web app signs in
 * this way: it shows a code, opens this page with it, and waits. Claiming the
 * code ties it to this account; approving lets the waiting app in.
 */
export function Device(props: { readonly userCode: string | null }) {
  const userCode = props.userCode?.trim().toUpperCase() ?? null;
  const [request, setRequest] = useState<Request>({ kind: "loading" });
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userCode) {
      setRequest({ kind: "missing" });
      return;
    }
    setRequest({ kind: "loading" });
    void authClient.device({ query: { user_code: userCode } }).then(({ data, error }) => {
      if (error || !data) {
        setRequest({
          kind: "error",
          message: errorMessage(error, "We couldn't find that code. It may have expired."),
        });
        return;
      }
      const clientId =
        "client_id" in data && typeof data.client_id === "string" ? data.client_id : null;
      setRequest({ kind: "found", status: data.status, clientId });
    });
  }, [userCode]);

  const answer = async (approve: boolean) => {
    if (!userCode) return;
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { error } = approve
      ? await authClient.device.approve({ userCode })
      : await authClient.device.deny({ userCode });
    setBusy(null);
    if (error) return setError(errorMessage(error, "That didn't go through. Try again."));
    setOutcome(approve ? "approved" : "denied");
  };

  if (request.kind === "missing") return <EnterCode />;
  if (request.kind === "loading") return <Spinner />;
  if (request.kind === "error") {
    return (
      <>
        <Heading title="Code not found" />
        <Notice tone="error">{request.message}</Notice>
        <div className="mt-6">
          <EnterCodeForm />
        </div>
      </>
    );
  }

  const app = describeClient(request.clientId);
  if (outcome === "approved") {
    return (
      <>
        <Heading title="You're signed in">
          {app} is signing in now. You can close this tab and go back to it.
        </Heading>
      </>
    );
  }
  if (outcome === "denied" || request.status === "denied") {
    return <Heading title="Sign-in denied">{app} was not signed in.</Heading>;
  }
  if (request.status !== "pending") {
    return <Heading title="This code was already used">Start a new sign-in from the app.</Heading>;
  }

  return (
    <>
      <Heading title={`Sign in to ${app}?`}>
        {app} wants to use your Astrolabe account. Approve only if you started this sign-in yourself
        and see the same code there.
      </Heading>
      <p
        aria-label="Sign-in code"
        className="mb-6 rounded-xl border border-line bg-surface py-4 text-center font-mono text-2xl tracking-widest text-text"
      >
        {userCode}
      </p>
      {error ? (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button busy={busy === "approve"} onClick={() => void answer(true)}>
          Approve
        </Button>
        <Button variant="secondary" busy={busy === "deny"} onClick={() => void answer(false)}>
          Deny
        </Button>
      </div>
    </>
  );
}

function EnterCode() {
  return (
    <>
      <Heading title="Enter your sign-in code">Type the code your app is showing.</Heading>
      <EnterCodeForm />
    </>
  );
}

function EnterCodeForm() {
  const [code, setCode] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(`${PATHS.device}?user_code=${encodeURIComponent(code.trim().toUpperCase())}`);
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Field
        label="Code"
        autoComplete="off"
        autoCapitalize="characters"
        required
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
      />
      <Button type="submit">Continue</Button>
    </form>
  );
}
