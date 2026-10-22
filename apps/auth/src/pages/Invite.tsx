import { useEffect, useState } from "react";

import { authClient, errorMessage } from "../auth";
import { navigate } from "../router";
import { Button, Heading, Notice, Spinner } from "../ui";
import { PATHS } from "../paths";

interface Invitation {
  readonly organizationName: string;
  readonly inviterEmail: string;
  readonly email: string;
  readonly status: string;
}

/**
 * An organization invitation from the invite email. Accepting it also lets a
 * waitlisted account in as a member of that organization.
 */
export function Invite(props: { readonly invitationId: string; readonly email: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    void authClient.organization
      .getInvitation({ query: { id: props.invitationId } })
      .then(({ data, error }) => {
        if (error || !data) {
          return setError(
            errorMessage(
              error,
              `This invitation isn't for ${props.email}, or it has expired. Sign in with the address it was sent to.`,
            ),
          );
        }
        setInvitation(data);
      });
  }, [props.invitationId, props.email]);

  const answer = async (accept: boolean) => {
    setBusy(accept ? "accept" : "decline");
    setError(null);
    const { error } = accept
      ? await authClient.organization.acceptInvitation({ invitationId: props.invitationId })
      : await authClient.organization.rejectInvitation({ invitationId: props.invitationId });
    setBusy(null);
    if (error) return setError(errorMessage(error, "That didn't go through. Try again."));
    setOutcome(accept ? "accepted" : "declined");
  };

  if (error && !invitation) {
    return (
      <>
        <Heading title="Invitation unavailable" />
        <Notice tone="error">{error}</Notice>
      </>
    );
  }
  if (!invitation) return <Spinner />;
  if (outcome === "accepted") {
    return (
      <>
        <Heading title={`You've joined ${invitation.organizationName}`}>
          Open Astrolabe and sign in with this account to work with your team.
        </Heading>
        <Button variant="secondary" onClick={() => navigate(PATHS.account)}>
          Go to your account
        </Button>
      </>
    );
  }
  if (outcome === "declined") return <Heading title="Invitation declined" />;
  if (invitation.status !== "pending") {
    return <Heading title="This invitation was already answered" />;
  }

  return (
    <>
      <Heading title={`Join ${invitation.organizationName}?`}>
        {invitation.inviterEmail} invited {invitation.email} to their workspace on Astrolabe.
      </Heading>
      {error ? (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button busy={busy === "accept"} onClick={() => void answer(true)}>
          Accept invitation
        </Button>
        <Button variant="secondary" busy={busy === "decline"} onClick={() => void answer(false)}>
          Decline
        </Button>
      </div>
    </>
  );
}
