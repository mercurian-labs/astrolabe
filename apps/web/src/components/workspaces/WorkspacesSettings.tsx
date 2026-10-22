import type { WorkspaceSync } from "@t3tools/client-runtime/workspaces";
import {
  administers,
  canCreateTeam,
  canInvite,
  invitePolicyOf,
  teamCreationPolicyOf,
  type WorkspacePolicy,
  type WorkspaceRole,
} from "@t3tools/shared/mercurianWorkspaces";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon, UserPlusIcon, XIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { startCloudSignIn, useCloudAccountState } from "../../cloud/account";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useWorkspaceSync } from "../../cloud/workspaces";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import {
  ConfirmByNameDialog,
  InviteDialog,
  ManageTeamDialog,
  NewTeamDialog,
  NewWorkspaceDialog,
  TransferOwnershipDialog,
} from "./WorkspaceDialogs";
import { useWorkspaceAction, useWorkspaceRows } from "./useWorkspaceRows";
import {
  buildWorkspaceViews,
  invitationsForYou,
  type WorkspaceTeam,
  type WorkspaceView,
} from "@t3tools/client-runtime/workspaces";

const ROLE_LABELS: Readonly<Record<WorkspaceRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};
const POLICY_LABELS: Readonly<Record<WorkspacePolicy, string>> = {
  members: "Everyone",
  admins: "Owner and admins",
};

/** Settings › Workspaces: the workspaces you belong to, their people and teams, and invitations to you. */
export function WorkspacesSettings() {
  const account = useCloudAccountState();
  const sync = useWorkspaceSync();
  return (
    <SettingsPageContainer>
      {!hasCloudPublicConfig() ? (
        // Without the cloud's addresses the account never loads; say why.
        <SettingsSection title="Workspaces">
          <SettingsRow
            title="Sign-in isn't set up in this build"
            description="Workspaces and teams need Astrolabe sign-in, which this build of Astrolabe doesn't include."
          />
        </SettingsSection>
      ) : account.status === "loading" ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : account.status === "signedOut" || sync === null ? (
        <SettingsSection title="Workspaces">
          <SettingsRow
            title="Sign in to work with your team"
            description="Workspaces and teams need an Astrolabe account. Everything else works without one."
            control={
              <Button size="sm" onClick={startCloudSignIn}>
                Sign in
              </Button>
            }
          />
        </SettingsSection>
      ) : (
        <SignedInWorkspaces
          sync={sync}
          email={account.user.email}
          canStartWorkspace={account.user.access === "approved"}
        />
      )}
    </SettingsPageContainer>
  );
}

function SignedInWorkspaces({
  sync,
  email,
  canStartWorkspace,
}: {
  sync: WorkspaceSync;
  email: string;
  canStartWorkspace: boolean;
}) {
  const { rows, ready } = useWorkspaceRows(sync);
  const views = useMemo(() => buildWorkspaceViews(rows, sync.userId), [rows, sync.userId]);
  const invitations = useMemo(
    () => invitationsForYou(rows, sync.userId, email),
    [rows, sync.userId, email],
  );
  const search = useSearch({ strict: false }) as { w?: string };
  const navigate = useNavigate();
  const selectSlug = (slug: string) =>
    void navigate({ to: "/settings/workspaces", search: { w: slug }, replace: true });
  const view = views.find((candidate) => candidate.workspace.slug === search.w) ?? views[0];
  const [creating, setCreating] = useState(false);
  const ownsWorkspace = views.some((candidate) => candidate.myRole === "owner");

  if (!ready) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      {invitations.length > 0 ? <InvitationsForYou sync={sync} invitations={invitations} /> : null}
      {view ? (
        <WorkspaceDetail
          key={view.workspace.id}
          sync={sync}
          view={view}
          picker={
            views.length > 1 ? (
              <Select
                value={view.workspace.slug}
                onValueChange={(slug) => slug && selectSlug(slug)}
              >
                <SelectTrigger size="sm" className="w-48" aria-label="Workspace">
                  <SelectValue>{view.workspace.name}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {views.map((candidate) => (
                    <SelectItem
                      hideIndicator
                      key={candidate.workspace.id}
                      value={candidate.workspace.slug}
                    >
                      {candidate.workspace.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null
          }
        />
      ) : (
        <SettingsSection title="Workspaces">
          <SettingsRow
            title="You're not in a workspace yet"
            description={
              canStartWorkspace
                ? "Start one for the people you work with, or accept an invitation."
                : "Someone can invite you to theirs. Starting your own needs approval off the waitlist."
            }
          />
        </SettingsSection>
      )}
      {canStartWorkspace && !ownsWorkspace ? (
        <div className="px-3 sm:px-4">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon />
            New workspace
          </Button>
          <NewWorkspaceDialog
            sync={sync}
            open={creating}
            onOpenChange={setCreating}
            onCreated={selectSlug}
          />
        </div>
      ) : null}
    </>
  );
}

function InvitationsForYou({
  sync,
  invitations,
}: {
  sync: WorkspaceSync;
  invitations: ReturnType<typeof invitationsForYou>;
}) {
  const { pending, run } = useWorkspaceAction();
  return (
    <SettingsSection title="Invitations for you" id="workspace-invitations-for-you">
      {invitations.map(({ invitation, workspace, inviter }) => (
        <SettingsRow
          key={invitation.id}
          title={workspace?.name ?? "A workspace"}
          description={`${inviter?.name || inviter?.email || "Someone"} invited you as ${ROLE_LABELS[invitation.role].toLowerCase()}.`}
          control={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void run("Couldn't decline the invitation", () =>
                    sync.write("declineInvitation", { invitationId: invitation.id }),
                  )
                }
              >
                Decline
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  void run("Couldn't accept the invitation", () =>
                    sync.write("acceptInvitation", { invitationId: invitation.id }),
                  )
                }
              >
                Accept
              </Button>
            </div>
          }
        />
      ))}
    </SettingsSection>
  );
}

function WorkspaceDetail({
  sync,
  view,
  picker,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  picker: ReactNode;
}) {
  const admin = administers(view.myRole);
  return (
    <>
      <SettingsSection title={view.workspace.name} id="workspace" headerAction={picker}>
        <WorkspaceNameRow sync={sync} view={view} editable={admin} />
        <SettingsRow
          title="Address"
          description="Open this workspace in the hosted app."
          control={<code className="text-xs text-muted-foreground">/w/{view.workspace.slug}</code>}
        />
        <PolicyRow
          sync={sync}
          view={view}
          editable={admin}
          id="workspace-invite-policy"
          title="Who can invite people"
          value={invitePolicyOf(view.workspace)}
          field="invitePolicy"
        />
        <PolicyRow
          sync={sync}
          view={view}
          editable={admin}
          id="workspace-team-policy"
          title="Who can create teams"
          value={teamCreationPolicyOf(view.workspace)}
          field="teamCreationPolicy"
        />
      </SettingsSection>
      <PeopleSection sync={sync} view={view} />
      <TeamsSection sync={sync} view={view} />
      <LeaveOrDeleteSection sync={sync} view={view} />
    </>
  );
}

function WorkspaceNameRow({
  sync,
  view,
  editable,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  editable: boolean;
}) {
  const { pending, run } = useWorkspaceAction();
  const [name, setName] = useState(view.workspace.name);
  const save = () => {
    const next = name.trim();
    if (!next || next === view.workspace.name) {
      setName(view.workspace.name);
      return;
    }
    void run("Couldn't rename the workspace", () =>
      sync.updateWorkspace({ organizationId: view.workspace.id, name: next }),
    );
  };
  return (
    <SettingsRow
      title="Name"
      control={
        editable ? (
          <Input
            size="sm"
            className="w-full sm:w-56"
            aria-label="Workspace name"
            value={name}
            maxLength={80}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        ) : (
          <span className="text-sm">{view.workspace.name}</span>
        )
      }
    />
  );
}

function PolicyRow({
  sync,
  view,
  editable,
  id,
  title,
  value,
  field,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  editable: boolean;
  id: string;
  title: string;
  value: WorkspacePolicy;
  field: "invitePolicy" | "teamCreationPolicy";
}) {
  const { pending, run } = useWorkspaceAction();
  return (
    <SettingsRow
      id={id}
      title={title}
      control={
        editable ? (
          <Select
            value={value}
            onValueChange={(next) => {
              if (next !== "members" && next !== "admins") return;
              void run("Couldn't change the policy", () =>
                sync.updateWorkspace({ organizationId: view.workspace.id, [field]: next }),
              );
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              aria-label={title}
              disabled={pending}
            >
              <SelectValue>{POLICY_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="members">
                {POLICY_LABELS.members}
              </SelectItem>
              <SelectItem hideIndicator value="admins">
                {POLICY_LABELS.admins}
              </SelectItem>
            </SelectPopup>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">{POLICY_LABELS[value]}</span>
        )
      }
    />
  );
}

function PeopleSection({ sync, view }: { sync: WorkspaceSync; view: WorkspaceView }) {
  const { pending, run } = useWorkspaceAction();
  const [inviting, setInviting] = useState(false);
  const admin = administers(view.myRole);
  return (
    <SettingsSection
      title="People"
      id="workspace-people"
      headerAction={
        canInvite(view.myRole, view.workspace) ? (
          <Button size="xs" variant="outline" onClick={() => setInviting(true)}>
            <UserPlusIcon />
            Invite
          </Button>
        ) : null
      }
    >
      {view.people.map(({ member, person }) => {
        const self = member.user_id === sync.userId;
        // The owner changes only by handing over; admins never touch the owner.
        const changeable = admin && !self && member.role !== "owner";
        return (
          <SettingsRow
            key={member.id}
            title={
              <span className="flex items-center gap-2">
                {person?.name || person?.email || "Someone"}
                {self ? <Badge variant="secondary">You</Badge> : null}
              </span>
            }
            description={person?.email}
            control={
              <div className="flex items-center gap-2">
                {changeable ? (
                  <Select
                    value={member.role}
                    onValueChange={(role) => {
                      if (role !== "admin" && role !== "member") return;
                      void run("Couldn't change their role", () =>
                        sync.setMemberRole({
                          organizationId: view.workspace.id,
                          memberId: member.id,
                          role,
                        }),
                      );
                    }}
                  >
                    <SelectTrigger size="sm" className="w-28" aria-label="Role" disabled={pending}>
                      <SelectValue>{ROLE_LABELS[member.role]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="admin">
                        Admin
                      </SelectItem>
                      <SelectItem hideIndicator value="member">
                        Member
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                ) : (
                  <span className="text-sm text-muted-foreground">{ROLE_LABELS[member.role]}</span>
                )}
                {changeable ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${person?.name ?? "them"} from the workspace`}
                    disabled={pending}
                    onClick={() =>
                      void run("Couldn't remove them", () =>
                        sync.removeMember({
                          organizationId: view.workspace.id,
                          memberId: member.id,
                        }),
                      )
                    }
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            }
          />
        );
      })}
      {view.pendingInvitations.map((invitation) => (
        <SettingsRow
          key={invitation.id}
          title={invitation.email}
          description={`Invited as ${ROLE_LABELS[invitation.role].toLowerCase()} · holds a seat until they answer`}
          control={
            admin ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  void run("Couldn't revoke the invitation", () =>
                    sync.revokeInvitation({ invitationId: invitation.id }),
                  )
                }
              >
                Revoke
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Invited</span>
            )
          }
        />
      ))}
      <InviteDialog sync={sync} view={view} open={inviting} onOpenChange={setInviting} />
    </SettingsSection>
  );
}

function TeamsSection({ sync, view }: { sync: WorkspaceSync; view: WorkspaceView }) {
  const [creating, setCreating] = useState(false);
  return (
    <SettingsSection
      title="Teams"
      id="workspace-teams"
      headerAction={
        canCreateTeam(view.myRole, view.workspace) ? (
          <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon />
            New team
          </Button>
        ) : null
      }
    >
      {view.teams.length === 0 ? (
        <SettingsRow title="No teams yet" description="Teams hold the work people share." />
      ) : (
        view.teams.map((team) => <TeamRow key={team.team.id} sync={sync} view={view} team={team} />)
      )}
      <NewTeamDialog sync={sync} view={view} open={creating} onOpenChange={setCreating} />
    </SettingsSection>
  );
}

function TeamRow({
  sync,
  view,
  team,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  team: WorkspaceTeam;
}) {
  const { pending, run } = useWorkspaceAction();
  const [managing, setManaging] = useState(false);
  const count = team.memberIds.length;
  return (
    <SettingsRow
      title={team.team.name}
      description={`${count} ${count === 1 ? "person" : "people"}${team.ownerIds.includes(sync.userId) ? " · you own it" : ""}`}
      control={
        <div className="flex items-center gap-2">
          {team.manageable ? (
            <Button size="xs" variant="ghost" onClick={() => setManaging(true)}>
              Manage
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void (team.joined
                ? run("Couldn't leave the team", () => sync.leaveTeam({ teamId: team.team.id }))
                : run("Couldn't join the team", () =>
                    sync.write("joinTeam", { teamId: team.team.id }),
                  ))
            }
          >
            {team.joined ? "Leave" : "Join"}
          </Button>
          {managing ? (
            <ManageTeamDialog
              sync={sync}
              view={view}
              team={team}
              open={managing}
              onOpenChange={setManaging}
            />
          ) : null}
        </div>
      }
    />
  );
}

function LeaveOrDeleteSection({ sync, view }: { sync: WorkspaceSync; view: WorkspaceView }) {
  const [dialog, setDialog] = useState<"leave" | "transfer" | "delete" | null>(null);
  const owner = view.myRole === "owner";
  const close = (open: boolean) => !open && setDialog(null);
  return (
    <SettingsSection title={owner ? "Hand over or delete" : "Leave"} id="workspace-leave">
      {owner ? (
        <>
          <SettingsRow
            title="Hand over the workspace"
            description="Make someone else its owner. You stay on as an admin."
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={view.people.length < 2}
                onClick={() => setDialog("transfer")}
              >
                Hand over…
              </Button>
            }
          />
          <SettingsRow
            title="Delete the workspace"
            description="Deletes its teams and everything published to them, for everyone."
            control={
              <Button size="sm" variant="destructive-outline" onClick={() => setDialog("delete")}>
                Delete…
              </Button>
            }
          />
        </>
      ) : (
        <SettingsRow
          title="Leave the workspace"
          description="You lose access at once. Threads you published stay with their teams."
          control={
            <Button size="sm" variant="destructive-outline" onClick={() => setDialog("leave")}>
              Leave…
            </Button>
          }
        />
      )}
      <TransferOwnershipDialog
        sync={sync}
        view={view}
        open={dialog === "transfer"}
        onOpenChange={close}
      />
      <ConfirmByNameDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={`Delete ${view.workspace.name}?`}
        description="Its teams, people and everything published to it are deleted for everyone, right away. Each person's own threads stay on their computers."
        name={view.workspace.name}
        submitLabel="Delete workspace"
        onConfirm={(run) =>
          run("Couldn't delete the workspace", () =>
            sync.write("deleteWorkspace", { organizationId: view.workspace.id }),
          )
        }
      />
      <ConfirmByNameDialog
        open={dialog === "leave"}
        onOpenChange={close}
        title={`Leave ${view.workspace.name}?`}
        description="You'll need a new invitation to come back."
        name={view.workspace.name}
        submitLabel="Leave workspace"
        onConfirm={(run) =>
          run("Couldn't leave the workspace", () =>
            sync.write("leaveWorkspace", { organizationId: view.workspace.id }),
          )
        }
      />
    </SettingsSection>
  );
}
