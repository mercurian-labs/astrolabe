import { StackActions, useNavigation, useRoute } from "@react-navigation/native";
import {
  administers,
  buildWorkspaceViews,
  canCreateTeam,
  canInvite,
  invitationsForYou,
  invitePolicyOf,
  slugFor,
  teamCreationPolicyOf,
  type WorkspacePolicy,
  type WorkspaceRole,
  type WorkspaceSync,
  type WorkspaceTeam,
  type WorkspaceView,
} from "@t3tools/client-runtime/workspaces";
import { useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { startCloudSignIn, useCloudAccountState } from "../cloud/account";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsChoiceRow } from "../settings/components/SettingsChoiceRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { useWorkspaceAction, useWorkspaceRows, useWorkspaceSync } from "./workspaceSync";

const ROLE_LABELS: Readonly<Record<WorkspaceRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};
const POLICY_LABELS: Readonly<Record<WorkspacePolicy, string>> = {
  members: "Everyone",
  admins: "Owner and admins",
};

type Screen =
  | { readonly kind: "list" }
  | { readonly kind: "workspace"; readonly id: string }
  | { readonly kind: "team"; readonly id: string; readonly teamId: string }
  | { readonly kind: "invite"; readonly id: string }
  | { readonly kind: "newTeam"; readonly id: string }
  | { readonly kind: "transfer"; readonly id: string }
  | { readonly kind: "delete"; readonly id: string }
  | { readonly kind: "newWorkspace" };

/**
 * Settings › Workspaces on mobile: your invitations, workspaces, people and teams. Opens at a
 * workspace from a /w/<short name> link, which appLinking drops without cloud config.
 */
export function WorkspacesRouteScreen() {
  return hasCloudPublicConfig() ? <ConfiguredWorkspacesRouteScreen /> : null;
}

function ConfiguredWorkspacesRouteScreen() {
  const account = useCloudAccountState();
  const sync = useWorkspaceSync();
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const navigation = useNavigation();
  // Each view is its own stack entry, so the native back button and swipe
  // pop exactly one level.
  const params = route.params as { slug?: string; view?: Screen } | undefined;
  const slug = params?.slug;
  const setScreen = (view: Screen) => navigation.dispatch(StackActions.push(route.name, { view }));
  const goBack = () => navigation.goBack();
  const toList = () => navigation.dispatch(StackActions.popTo("SettingsWorkspaces"));

  const frame = (title: string, _parent: unknown, children: ReactNode) => (
    <SettingsScreen title={title}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SettingsScreen>
  );

  if (account.status === "loading") return frame("Workspaces", undefined, <AppActivityIndicator />);
  if (account.status === "signedOut" || sync === null) {
    return frame(
      "Workspaces",
      undefined,
      <SettingsSection title="Sign in">
        <SettingsRow
          icon="person.badge.plus"
          label="Sign in to work with your team"
          value="Workspaces and teams need an Astrolabe account."
          onPress={startCloudSignIn}
        />
      </SettingsSection>,
    );
  }
  return (
    <SignedIn
      sync={sync}
      email={account.user.email}
      canStartWorkspace={account.user.access === "approved"}
      initialSlug={slug}
      view={params?.view}
      setScreen={setScreen}
      goBack={goBack}
      toList={toList}
      frame={frame}
    />
  );
}

function SignedIn(props: {
  sync: WorkspaceSync;
  email: string;
  canStartWorkspace: boolean;
  initialSlug: string | undefined;
  view: Screen | undefined;
  setScreen: (screen: Screen) => void;
  goBack: () => void;
  toList: () => void;
  frame: (title: string, parent: unknown, children: ReactNode) => ReactNode;
}) {
  const { sync, setScreen, frame, toList } = props;
  const { rows, ready } = useWorkspaceRows(sync);
  const views = useMemo(() => buildWorkspaceViews(rows, sync.userId), [rows, sync.userId]);
  const invitations = useMemo(
    () => invitationsForYou(rows, sync.userId, props.email),
    [rows, sync.userId, props.email],
  );
  if (!ready) return frame("Workspaces", undefined, <AppActivityIndicator />);

  const linked = views.find((view) => view.workspace.slug === props.initialSlug);
  const screen: Screen =
    props.view ?? (linked ? { kind: "workspace", id: linked.workspace.id } : { kind: "list" });
  const viewOf = (id: string) => views.find((view) => view.workspace.id === id);

  if (screen.kind === "list" || screen.kind === "newWorkspace") {
    const ownsWorkspace = views.some((view) => view.myRole === "owner");
    if (screen.kind === "newWorkspace") {
      return frame(
        "New workspace",
        toList,
        <NameForm
          label="Name"
          placeholder="Your company or project"
          note="It starts with one team of the same name, which you own."
          submitLabel="Create workspace"
          onSubmit={(name, run) =>
            run("Couldn't create the workspace", () =>
              sync.write("createWorkspace", {
                name,
                slug: `${slugFor(name)}-${Math.random().toString(36).slice(2, 6)}`,
              }),
            ).then((done) => {
              if (done) toList();
            })
          }
        />,
      );
    }
    return frame(
      "Workspaces",
      undefined,
      <>
        {invitations.length > 0 ? (
          <InvitationsForYouSection sync={sync} invitations={invitations} />
        ) : null}
        <SettingsSection title="Your workspaces">
          {views.length === 0 ? (
            <Text className="px-4 py-3 text-sm text-foreground-muted">
              {props.canStartWorkspace
                ? "Start one for the people you work with, or accept an invitation."
                : "Someone can invite you to theirs. Starting your own needs approval off the waitlist."}
            </Text>
          ) : (
            views.map((view) => (
              <SettingsRow
                key={view.workspace.id}
                icon="person.2"
                label={view.workspace.name}
                value={`${ROLE_LABELS[view.myRole]} · ${view.people.length} ${view.people.length === 1 ? "person" : "people"}`}
                onPress={() => setScreen({ kind: "workspace", id: view.workspace.id })}
              />
            ))
          )}
          {props.canStartWorkspace && !ownsWorkspace ? (
            <SettingsActionRow
              icon="plus"
              label="New workspace"
              onPress={() => setScreen({ kind: "newWorkspace" })}
            />
          ) : null}
        </SettingsSection>
      </>,
    );
  }

  const view = viewOf(screen.id);
  // Removed, left or deleted while open: back to the list.
  if (view === undefined) return frame("Workspaces", toList, null);
  // Forms and the team view were pushed from the workspace; finishing pops back to it.
  const toWorkspace = props.goBack;

  switch (screen.kind) {
    case "workspace":
      return frame(
        view.workspace.name,
        toList,
        <WorkspaceDetail sync={sync} view={view} setScreen={setScreen} onGone={toList} />,
      );
    case "team": {
      const team = view.teams.find((candidate) => candidate.team.id === screen.teamId);
      if (team === undefined) return frame(view.workspace.name, toWorkspace, null);
      return frame(
        team.team.name,
        toWorkspace,
        <TeamDetail sync={sync} view={view} team={team} onGone={toWorkspace} />,
      );
    }
    case "invite":
      return frame(
        "Invite",
        toWorkspace,
        <InviteForm sync={sync} view={view} onDone={toWorkspace} />,
      );
    case "newTeam":
      return frame(
        "New team",
        toWorkspace,
        <NameForm
          label="Name"
          note="You'll own it, and everyone in the workspace can see and join it."
          submitLabel="Create team"
          onSubmit={(name, run) =>
            run("Couldn't create the team", () =>
              sync.write("createTeam", { organizationId: view.workspace.id, name }),
            ).then((done) => {
              if (done) toWorkspace();
            })
          }
        />,
      );
    case "transfer":
      return frame(
        "Hand over",
        toWorkspace,
        <TransferForm sync={sync} view={view} onDone={toWorkspace} />,
      );
    case "delete":
      return frame(
        "Delete workspace",
        toWorkspace,
        <ConfirmByName
          name={view.workspace.name}
          warning="Its teams, people and everything published to it are deleted for everyone, right away. Each person's own threads stay on their computers."
          submitLabel="Delete workspace"
          onConfirm={(run) =>
            run("Couldn't delete the workspace", () =>
              sync.write("deleteWorkspace", { organizationId: view.workspace.id }),
            ).then((done) => {
              if (done) toList();
            })
          }
        />,
      );
  }
}

function InvitationsForYouSection({
  sync,
  invitations,
}: {
  sync: WorkspaceSync;
  invitations: ReturnType<typeof invitationsForYou>;
}) {
  const { pending, run } = useWorkspaceAction();
  return (
    <SettingsSection title="Invitations for you">
      {invitations.map(({ invitation, workspace, inviter }) => (
        <View key={invitation.id}>
          <SettingsRow
            icon="person.badge.plus"
            label={workspace?.name ?? "A workspace"}
            value={`${inviter?.name || inviter?.email || "Someone"} invited you as ${ROLE_LABELS[invitation.role].toLowerCase()}.`}
          />
          <SettingsActionRow
            icon="checkmark"
            label="Accept"
            loading={pending}
            onPress={() =>
              void run("Couldn't accept the invitation", () =>
                sync.write("acceptInvitation", { invitationId: invitation.id }),
              )
            }
          />
          <SettingsActionRow
            icon="xmark"
            label="Decline"
            disabled={pending}
            onPress={() =>
              void run("Couldn't decline the invitation", () =>
                sync.write("declineInvitation", { invitationId: invitation.id }),
              )
            }
          />
        </View>
      ))}
    </SettingsSection>
  );
}

function WorkspaceDetail({
  sync,
  view,
  setScreen,
  onGone,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  setScreen: (screen: Screen) => void;
  onGone: () => void;
}) {
  const { pending, run } = useWorkspaceAction();
  const admin = administers(view.myRole);
  const id = view.workspace.id;

  const personActions = (memberId: string, name: string, role: WorkspaceRole) =>
    Dialog.alert(name, undefined, [
      {
        text: role === "admin" ? "Make member" : "Make admin",
        onPress: () =>
          void run("Couldn't change their role", () =>
            sync.setMemberRole({
              organizationId: id,
              memberId,
              role: role === "admin" ? "member" : "admin",
            }),
          ),
      },
      {
        text: "Remove from workspace",
        style: "destructive",
        onPress: () =>
          void run("Couldn't remove them", () =>
            sync.removeMember({ organizationId: id, memberId }),
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);

  const setPolicy = (field: "invitePolicy" | "teamCreationPolicy", value: WorkspacePolicy) =>
    void run("Couldn't change the policy", () =>
      sync.updateWorkspace({ organizationId: id, [field]: value }),
    );

  return (
    <>
      {admin ? (
        <SettingsSection title="Name">
          <NameField
            initial={view.workspace.name}
            onSave={(name) =>
              void run("Couldn't rename the workspace", () =>
                sync.updateWorkspace({ organizationId: id, name }),
              )
            }
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title="People">
        {view.people.map(({ member, person }) => {
          const self = member.user_id === sync.userId;
          const name = person?.name || person?.email || "Someone";
          const changeable = admin && !self && member.role !== "owner";
          return (
            <SettingsRow
              key={member.id}
              icon={member.role === "owner" ? "star" : "person.crop.circle"}
              label={self ? `${name} (you)` : name}
              value={`${ROLE_LABELS[member.role]}${person?.email ? ` · ${person.email}` : ""}`}
              disabled={pending}
              {...(changeable
                ? { onPress: () => personActions(member.id, name, member.role) }
                : {})}
            />
          );
        })}
        {view.pendingInvitations.map((invitation) => (
          <SettingsRow
            key={invitation.id}
            icon="clock"
            label={invitation.email}
            value={`Invited as ${ROLE_LABELS[invitation.role].toLowerCase()}`}
            {...(admin
              ? {
                  onPress: () =>
                    Dialog.alert(invitation.email, "Revoke this invitation?", [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Revoke",
                        style: "destructive",
                        onPress: () =>
                          void run("Couldn't revoke the invitation", () =>
                            sync.revokeInvitation({ invitationId: invitation.id }),
                          ),
                      },
                    ]),
                }
              : {})}
          />
        ))}
        {canInvite(view.myRole, view.workspace) ? (
          <SettingsActionRow
            icon="person.badge.plus"
            label="Invite people"
            onPress={() => setScreen({ kind: "invite", id })}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Teams">
        {view.teams.map((team) => (
          <SettingsRow
            key={team.team.id}
            icon="person.2"
            label={team.team.name}
            value={`${team.memberIds.length} ${team.memberIds.length === 1 ? "person" : "people"}${team.joined ? " · you're on it" : ""}`}
            onPress={() => setScreen({ kind: "team", id, teamId: team.team.id })}
          />
        ))}
        {canCreateTeam(view.myRole, view.workspace) ? (
          <SettingsActionRow
            icon="plus"
            label="New team"
            onPress={() => setScreen({ kind: "newTeam", id })}
          />
        ) : null}
      </SettingsSection>

      {admin ? (
        <>
          <PolicySection
            title="Who can invite people"
            value={invitePolicyOf(view.workspace)}
            disabled={pending}
            onChange={(value) => setPolicy("invitePolicy", value)}
          />
          <PolicySection
            title="Who can create teams"
            value={teamCreationPolicyOf(view.workspace)}
            disabled={pending}
            onChange={(value) => setPolicy("teamCreationPolicy", value)}
          />
        </>
      ) : null}

      <SettingsSection title={view.myRole === "owner" ? "Hand over or delete" : "Leave"}>
        {view.myRole === "owner" ? (
          <>
            <SettingsActionRow
              icon="person.fill.checkmark"
              label="Hand over the workspace"
              disabled={view.people.length < 2}
              onPress={() => setScreen({ kind: "transfer", id })}
            />
            <SettingsActionRow
              icon="trash"
              label="Delete the workspace"
              tone="danger"
              onPress={() => setScreen({ kind: "delete", id })}
            />
          </>
        ) : (
          <SettingsActionRow
            icon="person.fill.xmark"
            label="Leave the workspace"
            tone="danger"
            loading={pending}
            onPress={() =>
              Dialog.alert(
                `Leave ${view.workspace.name}?`,
                "You lose access at once and need a new invitation to come back.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Leave",
                    style: "destructive",
                    onPress: () =>
                      void run("Couldn't leave the workspace", () =>
                        sync.write("leaveWorkspace", { organizationId: id }),
                      ).then((done) => {
                        if (done) onGone();
                      }),
                  },
                ],
              )
            }
          />
        )}
      </SettingsSection>
    </>
  );
}

function PolicySection(props: {
  title: string;
  value: WorkspacePolicy;
  disabled: boolean;
  onChange: (value: WorkspacePolicy) => void;
}) {
  return (
    <SettingsSection title={props.title}>
      {(["members", "admins"] as const).map((value, index) => (
        <SettingsChoiceRow
          key={value}
          label={POLICY_LABELS[value]}
          description={
            value === "members" ? "Every member of the workspace." : "Only the owner and admins."
          }
          selected={props.value === value}
          separated={index > 0}
          disabled={props.disabled}
          onPress={() => props.value !== value && props.onChange(value)}
        />
      ))}
    </SettingsSection>
  );
}

function TeamDetail({
  sync,
  view,
  team,
  onGone,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  team: WorkspaceTeam;
  onGone: () => void;
}) {
  const { pending, run } = useWorkspaceAction();
  const [deleting, setDeleting] = useState(false);
  const teamPeople = view.people.filter((person) => team.memberIds.includes(person.member.user_id));
  if (deleting) {
    return (
      <ConfirmByName
        name={team.team.name}
        warning="The team and everything published to it are deleted for everyone, right away. Each person's own threads stay on their computers."
        submitLabel="Delete team"
        onConfirm={(confirmRun) =>
          confirmRun("Couldn't delete the team", () =>
            sync.write("deleteTeam", { organizationId: view.workspace.id, teamId: team.team.id }),
          ).then((done) => {
            if (done) onGone();
          })
        }
      />
    );
  }
  return (
    <>
      <SettingsSection title="You">
        <SettingsActionRow
          icon={team.joined ? "person.fill.xmark" : "person.badge.plus"}
          label={team.joined ? "Leave team" : "Join team"}
          loading={pending}
          onPress={() =>
            void (team.joined
              ? run("Couldn't leave the team", () => sync.leaveTeam({ teamId: team.team.id }))
              : run("Couldn't join the team", () =>
                  sync.write("joinTeam", { teamId: team.team.id }),
                ))
          }
        />
      </SettingsSection>
      {team.manageable ? (
        <>
          <SettingsSection title="Name">
            <NameField
              initial={team.team.name}
              onSave={(name) =>
                void run("Couldn't rename the team", () =>
                  sync.renameTeam({
                    organizationId: view.workspace.id,
                    teamId: team.team.id,
                    name,
                  }),
                )
              }
            />
          </SettingsSection>
          <SettingsSection title="Owners">
            {teamPeople.length === 0 ? (
              <Text className="px-4 py-3 text-sm text-foreground-muted">
                Nobody is on this team yet.
              </Text>
            ) : (
              teamPeople.map(({ member, person }) => (
                <SettingsSwitchRow
                  key={member.id}
                  icon="star"
                  label={person?.name || person?.email || "Someone"}
                  value={team.ownerIds.includes(member.user_id)}
                  disabled={pending}
                  onValueChange={(owner) =>
                    void run("Couldn't change the team's owners", () =>
                      sync.write("setTeamOwner", {
                        teamId: team.team.id,
                        userId: member.user_id,
                        owner,
                      }),
                    )
                  }
                />
              ))
            )}
          </SettingsSection>
          <SettingsSection>
            <SettingsActionRow
              icon="trash"
              label="Delete team"
              tone="danger"
              onPress={() => setDeleting(true)}
            />
          </SettingsSection>
        </>
      ) : (
        <SettingsSection title="People">
          {teamPeople.map(({ member, person }) => (
            <SettingsRow
              key={member.id}
              icon={team.ownerIds.includes(member.user_id) ? "star" : "person.crop.circle"}
              label={person?.name || person?.email || "Someone"}
              value={team.ownerIds.includes(member.user_id) ? "Owner" : "Member"}
            />
          ))}
        </SettingsSection>
      )}
    </>
  );
}

function InviteForm({
  sync,
  view,
  onDone,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  onDone: () => void;
}) {
  const { pending, run } = useWorkspaceAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [teamId, setTeamId] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  return (
    <>
      <SettingsSection title="Email">
        <View className="px-4 py-3">
          <AppTextInput
            accessibilityLabel="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="name@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
          />
        </View>
      </SettingsSection>
      {administers(view.myRole) ? (
        <SettingsSection title="Role">
          {(["member", "admin"] as const).map((value, index) => (
            <SettingsChoiceRow
              key={value}
              label={ROLE_LABELS[value]}
              description={
                value === "admin"
                  ? "Manages people, invitations, teams and policies."
                  : "Works in every team."
              }
              selected={role === value}
              separated={index > 0}
              disabled={pending}
              onPress={() => setRole(value)}
            />
          ))}
        </SettingsSection>
      ) : null}
      {view.teams.length > 0 ? (
        <SettingsSection title="Add to a team (optional)">
          {[null, ...view.teams].map((team, index) => (
            <SettingsChoiceRow
              key={team?.team.id ?? "none"}
              label={team?.team.name ?? "No team"}
              description={
                team ? "They join this team when they accept." : "They join the workspace only."
              }
              selected={teamId === (team?.team.id ?? null)}
              separated={index > 0}
              disabled={pending}
              onPress={() => setTeamId(team?.team.id ?? null)}
            />
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection>
        <SettingsActionRow
          icon="person.badge.plus"
          label="Send invitation"
          disabled={!valid}
          loading={pending}
          onPress={() =>
            void run("Couldn't send the invitation", () =>
              sync.write("invite", {
                organizationId: view.workspace.id,
                email: email.trim(),
                role,
                ...(teamId ? { teamId } : {}),
              }),
            ).then((done) => {
              if (done) onDone();
            })
          }
        />
      </SettingsSection>
    </>
  );
}

function TransferForm({
  sync,
  view,
  onDone,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  onDone: () => void;
}) {
  const { pending, run } = useWorkspaceAction();
  const candidates = view.people.filter((person) => person.member.role !== "owner");
  return (
    <SettingsSection title="New owner">
      <Text className="px-4 py-3 text-sm text-foreground-muted">
        The new owner governs the workspace, including deleting it. You stay on as an admin.
      </Text>
      {candidates.map(({ member, person }) => (
        <SettingsActionRow
          key={member.id}
          icon="person.fill.checkmark"
          label={person?.name || person?.email || "Someone"}
          disabled={pending}
          onPress={() =>
            Dialog.alert(
              `Hand ${view.workspace.name} to ${person?.name || person?.email || "them"}?`,
              undefined,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Hand over",
                  onPress: () =>
                    void run("Couldn't hand over the workspace", () =>
                      sync.write("transferOwnership", {
                        organizationId: view.workspace.id,
                        userId: member.user_id,
                      }),
                    ).then((done) => {
                      if (done) onDone();
                    }),
                },
              ],
            )
          }
        />
      ))}
    </SettingsSection>
  );
}

/** A single-line name that saves when editing ends. */
function NameField(props: { initial: string; onSave: (name: string) => void }) {
  return (
    <View className="px-4 py-3">
      <AppTextInput
        key={props.initial}
        accessibilityLabel="Name"
        defaultValue={props.initial}
        maxLength={80}
        className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
        onEndEditing={(event) => {
          const name = event.nativeEvent.text.trim();
          if (name && name !== props.initial) props.onSave(name);
        }}
      />
    </View>
  );
}

function NameForm(props: {
  label: string;
  note: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string, run: ReturnType<typeof useWorkspaceAction>["run"]) => Promise<void>;
}) {
  const { pending, run } = useWorkspaceAction();
  const [name, setName] = useState("");
  return (
    <>
      <SettingsSection title={props.label}>
        <View className="gap-2 px-4 py-3">
          <AppTextInput
            accessibilityLabel={props.label}
            value={name}
            onChangeText={setName}
            maxLength={80}
            autoFocus
            {...(props.placeholder ? { placeholder: props.placeholder } : {})}
            className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
          />
          <Text className="text-sm text-foreground-muted">{props.note}</Text>
        </View>
      </SettingsSection>
      <SettingsSection>
        <SettingsActionRow
          icon="plus"
          label={props.submitLabel}
          disabled={!name.trim()}
          loading={pending}
          onPress={() => void props.onSubmit(name.trim(), run)}
        />
      </SettingsSection>
    </>
  );
}

/** Asks for the name to be typed before an irreversible delete. */
function ConfirmByName(props: {
  name: string;
  warning: string;
  submitLabel: string;
  onConfirm: (run: ReturnType<typeof useWorkspaceAction>["run"]) => Promise<void>;
}) {
  const { pending, run } = useWorkspaceAction();
  const [typed, setTyped] = useState("");
  return (
    <>
      <SettingsSection title={`Type ${props.name} to confirm`}>
        <View className="gap-2 px-4 py-3">
          <Text className="text-sm text-foreground-muted">{props.warning}</Text>
          <AppTextInput
            accessibilityLabel={`Type ${props.name} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
          />
        </View>
      </SettingsSection>
      <SettingsSection>
        <SettingsActionRow
          icon="trash"
          label={props.submitLabel}
          tone="danger"
          disabled={typed.trim() !== props.name}
          loading={pending}
          onPress={() => void props.onConfirm(run)}
        />
      </SettingsSection>
    </>
  );
}
