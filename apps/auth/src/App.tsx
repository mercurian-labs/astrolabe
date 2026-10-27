import { useEffect, useState } from "react";

import { authClient } from "./auth";
import { safeReturnUrl } from "./config";
import { Account } from "./pages/Account";
import { Device } from "./pages/Device";
import { Invite } from "./pages/Invite";
import { ResetPassword } from "./pages/ResetPassword";
import { SignIn } from "./pages/SignIn";
import { PATHS } from "./paths";
import { navigate, useLocation } from "./router";
import { Heading, Link, Notice, Page, Spinner } from "./ui";

/** Paths that need a signed-in account; anyone else goes to sign-in and comes back. */
const SIGNED_IN_PATHS: ReadonlyArray<string> = [PATHS.account, PATHS.device, PATHS.invitePrefix];

export function App() {
  const location = useLocation();
  const session = authClient.useSession();
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const params = location.searchParams;
  const here = path + location.search + location.hash;
  const needsSession = path === "/" || SIGNED_IN_PATHS.some((prefix) => path.startsWith(prefix));

  // Only the first session read shows the loading page. Later re-reads (after
  // signing in) must not unmount a page midway through its steps.
  const [loaded, setLoaded] = useState(false);
  if (!loaded && !session.isPending) setLoaded(true);
  if (!loaded && session.isPending) return <Page>{<Spinner />}</Page>;

  const signedIn = session.data !== null;
  if (needsSession && !signedIn) {
    return (
      <Redirect
        to={`${PATHS.signIn}?callbackURL=${encodeURIComponent(path === "/" ? PATHS.account : here)}`}
      />
    );
  }
  const returnTo = params.get("callbackURL");
  if (path === PATHS.signIn && signedIn) {
    return <Redirect to={safeReturnUrl(returnTo)} />;
  }

  if (path === "/" || path === PATHS.account) {
    const { user, session: current } = session.data!;
    return (
      <Page wide>
        <Account user={user} sessionToken={current.token} />
      </Page>
    );
  }
  if (path === PATHS.signIn) {
    return (
      <Page welcome>
        {params.get("reset") ? (
          <div className="mb-6">
            <Notice>Your password was changed. Sign in with the new one.</Notice>
          </div>
        ) : null}
        {params.get("error") ? (
          <div className="mb-6">
            <Notice tone="error">That sign-in didn't work. Try again or use another way.</Notice>
          </div>
        ) : null}
        <SignIn returnTo={returnTo} />
      </Page>
    );
  }
  if (path === PATHS.resetPassword) {
    return (
      <Page>
        <ResetPassword email={params.get("email")} />
      </Page>
    );
  }
  if (path === PATHS.device) {
    return (
      <Page>
        <Device userCode={params.get("user_code")} />
      </Page>
    );
  }
  if (path.startsWith(PATHS.invitePrefix)) {
    return (
      <Page>
        <Invite
          invitationId={decodeURIComponent(path.slice(PATHS.invitePrefix.length))}
          email={session.data!.user.email}
        />
      </Page>
    );
  }
  if (path === PATHS.deleted) {
    return (
      <Page>
        <Heading title="Your account was deleted">
          Your Astrolabe account and its data are gone, and every device it was signed in on is
          signed out.
        </Heading>
      </Page>
    );
  }
  return (
    <Page>
      <Heading title="Page not found" />
      <Link to={PATHS.account}>Go to your account</Link>
    </Page>
  );
}

/** Leaves for `to` after rendering, showing the loading state meanwhile. */
function Redirect(props: { readonly to: string }) {
  useEffect(() => navigate(props.to, { replace: true }), [props.to]);
  return <Page>{<Spinner />}</Page>;
}
