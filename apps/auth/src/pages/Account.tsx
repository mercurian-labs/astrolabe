import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

import { authClient, errorMessage, isOnWaitlist } from "../auth";
import { pageConfig, type SocialProvider } from "../config";
import { navigate } from "../router";
import { Button, Card, Field, Heading, Notice } from "../ui";
import { PATHS } from "../paths";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
};

interface AccountUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly access?: unknown;
}

/**
 * Account settings on app.astrolabe.sh: how you sign in, your passkeys and
 * sessions, and deleting the account. The apps link here for sign-in methods
 * and keep their own deletion button as the stores require.
 */
export function Account(props: { readonly user: AccountUser; readonly sessionToken: string }) {
  const { user } = props;
  const onWaitlist = isOnWaitlist(user.access);
  return (
    <>
      <Heading title="Your Astrolabe account">{user.email}</Heading>
      <div className="flex flex-col gap-4">
        {onWaitlist ? (
          <Notice tone="warning">
            You're on the waitlist. T3 Connect turns on once your account is approved, and we'll
            email you when it is.
          </Notice>
        ) : null}
        <Profile user={user} />
        <SignInMethods email={user.email} />
        <Passkeys />
        <Sessions currentToken={props.sessionToken} />
        <DangerZone onWaitlist={onWaitlist} />
      </div>
    </>
  );
}

function Profile(props: { readonly user: AccountUser }) {
  const [name, setName] = useState(props.user.name);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setState("saving");
    setError(null);
    const { error } = await authClient.updateUser({ name });
    if (error) {
      setState("idle");
      return setError(errorMessage(error, "We couldn't save your name."));
    }
    setState("saved");
  };
  return (
    <Card title="Profile">
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <Field
          label="Name"
          autoComplete="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setState("idle");
          }}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="secondary"
            busy={state === "saving"}
            disabled={name.trim() === props.user.name}
          >
            Save
          </Button>
          {state === "saved" ? <span className="text-sm text-muted">Saved</span> : null}
        </div>
      </form>
    </Card>
  );
}

/** `id` is Better Auth's own account id, the one unlinking takes. */
interface LinkedAccount {
  readonly id: string;
  readonly providerId: string;
}

function SignInMethods(props: { readonly email: string }) {
  const [accounts, setAccounts] = useState<ReadonlyArray<LinkedAccount> | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await authClient.listAccounts();
    if (error) return setError(errorMessage(error, "We couldn't load your sign-in methods."));
    setAccounts(data ?? []);
  }, []);
  useEffect(() => void load(), [load]);

  const hasPassword = accounts?.some((account) => account.providerId === "credential") ?? false;
  const linked = (provider: string) =>
    accounts?.find((account) => account.providerId === provider) ?? null;

  const connect = async (provider: SocialProvider) => {
    setBusy(provider);
    setError(null);
    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: `${window.location.origin}/account`,
    });
    if (error) {
      setBusy(null);
      setError(errorMessage(error, `Couldn't connect ${PROVIDER_LABELS[provider]}.`));
    }
  };

  const disconnect = async (account: LinkedAccount) => {
    setBusy(account.providerId);
    setError(null);
    const { error } = await authClient.unlinkAccount({ accountId: account.id });
    setBusy(null);
    if (error) {
      return setError(
        errorMessage(error, "Keep at least one way to sign in before removing this."),
      );
    }
    await load();
  };

  return (
    <Card title="Sign-in methods">
      <ul className="flex flex-col divide-y divide-line">
        <Row
          label="Email code"
          detail={`Codes go to ${props.email}. Always available.`}
          action={null}
        />
        <Row
          label="Password"
          detail={hasPassword ? "Set. Signing in asks for a second step." : "Not set."}
          action={
            accounts === null ? null : hasPassword ? (
              <Button variant="secondary" onClick={() => setChangingPassword((open) => !open)}>
                Change
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  navigate(`${PATHS.resetPassword}?email=${encodeURIComponent(props.email)}`)
                }
              >
                Set a password
              </Button>
            )
          }
        />
        {changingPassword ? (
          <li className="py-3">
            <ChangePassword onDone={() => setChangingPassword(false)} />
          </li>
        ) : null}
        {pageConfig.providers.map((provider) => {
          const account = linked(provider);
          return (
            <Row
              key={provider}
              label={PROVIDER_LABELS[provider] ?? provider}
              detail={account ? "Connected." : "Not connected."}
              action={
                accounts === null ? null : account ? (
                  <Button
                    variant="secondary"
                    busy={busy === provider}
                    onClick={() => void disconnect(account)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    busy={busy === provider}
                    onClick={() => void connect(provider)}
                  >
                    Connect
                  </Button>
                )
              }
            />
          );
        })}
      </ul>
      {error ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function ChangePassword(props: { readonly onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (error) return setError(errorMessage(error, "We couldn't change your password."));
    props.onDone();
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <Field
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
      />
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={128}
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        hint="Changing it signs out your other sessions."
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" busy={busy}>
        Change password
      </Button>
    </form>
  );
}

type PasskeyRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.passkey.listUserPasskeys>>["data"]
>[number];

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const formatDate = (value: Date | string) => dateFormatter.format(new Date(value));

function Passkeys() {
  const [passkeys, setPasskeys] = useState<ReadonlyArray<PasskeyRecord> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) return setError(errorMessage(error, "We couldn't load your passkeys."));
    setPasskeys(data ?? []);
  }, []);
  useEffect(() => void load(), [load]);

  const add = async () => {
    setBusy("add");
    setError(null);
    const { error } = await authClient.passkey.addPasskey({ name: deviceName() });
    setBusy(null);
    if (error) return setError(errorMessage(error, "The passkey wasn't saved."));
    await load();
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    const { error } = await authClient.passkey.deletePasskey({ id });
    setBusy(null);
    if (error) return setError(errorMessage(error, "We couldn't remove that passkey."));
    await load();
  };

  return (
    <Card title="Passkeys">
      <p className="mb-3 text-sm text-muted">
        Sign in with your fingerprint, face or device PIN instead of a code or password.
      </p>
      {passkeys && passkeys.length > 0 ? (
        <ul className="mb-3 flex flex-col divide-y divide-line">
          {passkeys.map((passkey) => (
            <Row
              key={passkey.id}
              label={passkey.name || "Passkey"}
              detail={`Added ${formatDate(passkey.createdAt)}`}
              action={
                <Button
                  variant="secondary"
                  busy={busy === passkey.id}
                  onClick={() => void remove(passkey.id)}
                >
                  Remove
                </Button>
              }
            />
          ))}
        </ul>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <Button variant="secondary" busy={busy === "add"} onClick={() => void add()}>
        Add a passkey
      </Button>
    </Card>
  );
}

/** A default passkey name people recognise later, e.g. "Mac · Safari". */
function deviceName(): string {
  const agent = navigator.userAgent;
  const platform = /iPhone|iPad/.test(agent)
    ? "iPhone or iPad"
    : /Android/.test(agent)
      ? "Android"
      : /Mac/.test(agent)
        ? "Mac"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "This device";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : null;
  return browser ? `${platform} · ${browser}` : platform;
}

type SessionRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.listSessions>>["data"]
>[number];

/** What a session's user agent was, in words: Astrolabe's own clients send none. */
function describeSession(userAgent: string | null | undefined): string {
  if (!userAgent) return "Astrolabe app";
  if (/^Bun\/|node|undici/i.test(userAgent)) return "Astrolabe app";
  return deviceNameFrom(userAgent);
}

function deviceNameFrom(agent: string): string {
  const os = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "Unknown device";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : null;
  return browser ? `${browser} on ${os}` : os;
}

function Sessions(props: { readonly currentToken: string }) {
  const [sessions, setSessions] = useState<ReadonlyArray<SessionRecord> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await authClient.listSessions();
    if (error) return setError(errorMessage(error, "We couldn't load your sessions."));
    setSessions(data ?? []);
  }, []);
  useEffect(() => void load(), [load]);

  const revoke = async (token: string) => {
    setBusy(token);
    setError(null);
    const { error } = await authClient.revokeSession({ token });
    setBusy(null);
    if (error) return setError(errorMessage(error, "We couldn't sign that session out."));
    await load();
  };

  const revokeOthers = async () => {
    setBusy("others");
    setError(null);
    const { error } = await authClient.revokeOtherSessions();
    setBusy(null);
    if (error) return setError(errorMessage(error, "We couldn't sign out your other sessions."));
    await load();
  };

  const others = sessions?.filter((session) => session.token !== props.currentToken) ?? [];
  return (
    <Card title="Where you're signed in">
      <ul className="mb-3 flex flex-col divide-y divide-line">
        {(sessions ?? []).map((session) => {
          const current = session.token === props.currentToken;
          return (
            <Row
              key={session.id}
              label={
                current
                  ? `${describeSession(session.userAgent)} (this browser)`
                  : describeSession(session.userAgent)
              }
              detail={`Signed in ${formatDate(session.createdAt)}`}
              action={
                current ? null : (
                  <Button
                    variant="secondary"
                    busy={busy === session.token}
                    onClick={() => void revoke(session.token)}
                  >
                    Sign out
                  </Button>
                )
              }
            />
          );
        })}
      </ul>
      {error ? (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {others.length > 0 ? (
        <Button variant="secondary" busy={busy === "others"} onClick={() => void revokeOthers()}>
          Sign out everywhere else
        </Button>
      ) : null}
    </Card>
  );
}

function DangerZone(props: { readonly onWaitlist: boolean }) {
  const [confirming, setConfirming] = useState(window.location.hash === "#delete");
  const [busy, setBusy] = useState<"delete" | "sign-out" | null>(null);
  const [problem, setProblem] = useState<"sign-in-again" | string | null>(null);

  const signOut = async () => {
    setBusy("sign-out");
    await authClient.signOut();
    navigate(PATHS.signIn, { replace: true });
  };

  const remove = async () => {
    setBusy("delete");
    setProblem(null);
    const { error } = await authClient.deleteUser({});
    setBusy(null);
    if (!error) return navigate(PATHS.deleted, { replace: true });
    if (error.code === "SESSION_EXPIRED") return setProblem("sign-in-again");
    if (error.code === "OWNS_SHARED_ORGANIZATION") {
      return setProblem(
        "You own an organization with other members. Hand it over or remove them first.",
      );
    }
    setProblem(errorMessage(error, "Your account could not be deleted. Try again later."));
  };

  const action = props.onWaitlist ? "Leave the waitlist" : "Delete account";
  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" busy={busy === "sign-out"} onClick={() => void signOut()}>
          Sign out
        </Button>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {action}
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-raised p-4">
          <p className="text-sm text-text">
            {props.onWaitlist
              ? "This deletes your account and gives up your place on the list."
              : "This deletes your account, unlinks your machines from T3 Connect, and signs out every app. Organizations you own alone are deleted too. It can't be undone."}
          </p>
          {problem === "sign-in-again" ? (
            <Notice tone="warning">
              For your security, sign in again before deleting your account.
            </Notice>
          ) : problem ? (
            <Notice tone="error">{problem}</Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {problem === "sign-in-again" ? (
              <Button
                onClick={() =>
                  void authClient
                    .signOut()
                    .then(() => navigate(`${PATHS.signIn}?callbackURL=%2Faccount%23delete`))
                }
              >
                Sign in again
              </Button>
            ) : (
              <Button variant="danger" busy={busy === "delete"} onClick={() => void remove()}>
                {action}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function Row(props: {
  readonly label: string;
  readonly detail: string;
  readonly action: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{props.label}</p>
        <p className="text-xs text-muted">{props.detail}</p>
      </div>
      {props.action}
    </li>
  );
}
