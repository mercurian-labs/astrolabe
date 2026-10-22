import type { WorkspaceSync } from "@t3tools/client-runtime/workspaces";
import { administers } from "@t3tools/shared/mercurianWorkspaces";
import { useState, type ReactNode } from "react";

import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { useWorkspaceAction } from "./useWorkspaceRows";
import {
  slugFor,
  type WorkspaceTeam,
  type WorkspaceView,
} from "@t3tools/client-runtime/workspaces";

/** A dialog with a form whose primary action runs a workspace write and closes on success. */
function WriteDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  submitVariant = "default",
  canSubmit,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  submitLabel: string;
  submitVariant?: "default" | "destructive";
  canSubmit: boolean;
  /** Resolves true when the write landed. */
  onSubmit: () => Promise<boolean>;
  children?: ReactNode;
}) {
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const done = await onSubmit();
    setSubmitting(false);
    if (done) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children ? (
          <DialogPanel>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {children}
            </form>
          </DialogPanel>
        ) : null}
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={submitVariant}
            disabled={!canSubmit || submitting}
            onClick={() => void submit()}
          >
            {submitting ? <Spinner size="sm" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function InviteDialog({
  sync,
  view,
  open,
  onOpenChange,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run } = useWorkspaceAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [teamId, setTeamId] = useState<string>("");
  const canGrantAdmin = administers(view.myRole);
  return (
    <WriteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setEmail("");
          setRole("member");
          setTeamId("");
        }
        onOpenChange(next);
      }}
      title={`Invite to ${view.workspace.name}`}
      description="They get an email, and join once they sign in with that address and accept."
      submitLabel="Send invitation"
      canSubmit={/^\S+@\S+\.\S+$/.test(email.trim())}
      onSubmit={() =>
        run("Couldn't send the invitation", () =>
          sync.write("invite", {
            organizationId: view.workspace.id,
            email: email.trim(),
            role,
            ...(teamId ? { teamId } : {}),
          }),
        )
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          placeholder="name@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoFocus
        />
      </div>
      {canGrantAdmin ? (
        <div className="grid gap-1.5">
          <Label>Role</Label>
          <Select
            value={role}
            onValueChange={(value) => value && setRole(value as "member" | "admin")}
          >
            <SelectTrigger aria-label="Role">
              <SelectValue>{role === "admin" ? "Admin" : "Member"}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="member">
                Member
              </SelectItem>
              <SelectItem hideIndicator value="admin">
                Admin
              </SelectItem>
            </SelectPopup>
          </Select>
        </div>
      ) : null}
      {view.teams.length > 0 ? (
        <div className="grid gap-1.5">
          <Label>Add to a team (optional)</Label>
          <Select value={teamId} onValueChange={(value) => setTeamId(value ?? "")}>
            <SelectTrigger aria-label="Team">
              <SelectValue>
                {view.teams.find((team) => team.team.id === teamId)?.team.name ?? "No team"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="">
                No team
              </SelectItem>
              {view.teams.map(({ team }) => (
                <SelectItem hideIndicator key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : null}
    </WriteDialog>
  );
}

export function NewTeamDialog({
  sync,
  view,
  open,
  onOpenChange,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run } = useWorkspaceAction();
  const [name, setName] = useState("");
  return (
    <WriteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("");
        onOpenChange(next);
      }}
      title="New team"
      description={`A team in ${view.workspace.name}. You'll own it, and everyone in the workspace can see and join it.`}
      submitLabel="Create team"
      canSubmit={name.trim().length > 0}
      onSubmit={() =>
        run("Couldn't create the team", () =>
          sync.write("createTeam", { organizationId: view.workspace.id, name: name.trim() }),
        )
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="team-name">Name</Label>
        <Input
          id="team-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </div>
    </WriteDialog>
  );
}

/** Renames a team, names its owners, and deletes it. Only for people who can manage it. */
export function ManageTeamDialog({
  sync,
  view,
  team,
  open,
  onOpenChange,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  team: WorkspaceTeam;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rename = useWorkspaceAction();
  const owners = useWorkspaceAction();
  const [name, setName] = useState(team.team.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const teamPeople = view.people.filter((person) => team.memberIds.includes(person.member.user_id));
  return (
    <>
      <Dialog open={open && !confirmingDelete} onOpenChange={onOpenChange}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>{team.team.name}</DialogTitle>
            <DialogDescription>
              Team owners rename and delete the team and name its other owners. The workspace's
              owner and admins own every team.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="grid gap-5">
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim() && name.trim() !== team.team.name) {
                    void rename.run("Couldn't rename the team", () =>
                      sync.renameTeam({
                        organizationId: view.workspace.id,
                        teamId: team.team.id,
                        name: name.trim(),
                      }),
                    );
                  }
                }}
              >
                <div className="grid flex-1 gap-1.5">
                  <Label htmlFor="team-rename">Name</Label>
                  <Input
                    id="team-rename"
                    value={name}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={rename.pending || !name.trim() || name.trim() === team.team.name}
                >
                  Rename
                </Button>
              </form>
              <div className="grid gap-2">
                <Label>Owners</Label>
                {teamPeople.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nobody is on this team yet.</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {teamPeople.map(({ member, person }) => (
                      <li key={member.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm">
                          {person?.name || person?.email || "Someone"}
                        </span>
                        <Switch
                          aria-label={`${person?.name ?? "Someone"} owns this team`}
                          checked={team.ownerIds.includes(member.user_id)}
                          disabled={owners.pending}
                          onCheckedChange={(owner) =>
                            void owners.run("Couldn't change the team's owners", () =>
                              sync.write("setTeamOwner", {
                                teamId: team.team.id,
                                userId: member.user_id,
                                owner,
                              }),
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button variant="destructive-outline" onClick={() => setConfirmingDelete(true)}>
              Delete team…
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <ConfirmByNameDialog
        open={open && confirmingDelete}
        onOpenChange={(next) => {
          setConfirmingDelete(next);
          if (!next) onOpenChange(false);
        }}
        title={`Delete ${team.team.name}?`}
        description="The team and everything published to it are deleted for everyone, right away. Each person's own threads stay on their computers."
        name={team.team.name}
        submitLabel="Delete team"
        onConfirm={(run) =>
          run("Couldn't delete the team", () =>
            sync.write("deleteTeam", {
              organizationId: view.workspace.id,
              teamId: team.team.id,
            }),
          )
        }
      />
    </>
  );
}

/** Asks for the thing's name to be typed before an irreversible delete. */
export function ConfirmByNameDialog({
  open,
  onOpenChange,
  title,
  description,
  name,
  submitLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  name: string;
  submitLabel: string;
  onConfirm: (run: ReturnType<typeof useWorkspaceAction>["run"]) => Promise<boolean>;
}) {
  const { run } = useWorkspaceAction();
  const [typed, setTyped] = useState("");
  return (
    <WriteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
      title={title}
      description={description}
      submitLabel={submitLabel}
      submitVariant="destructive"
      canSubmit={typed.trim() === name}
      onSubmit={() => onConfirm(run)}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="confirm-name">
          Type <span className="font-medium text-foreground">{name}</span> to confirm
        </Label>
        <Input
          id="confirm-name"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoFocus
        />
      </div>
    </WriteDialog>
  );
}

export function TransferOwnershipDialog({
  sync,
  view,
  open,
  onOpenChange,
}: {
  sync: WorkspaceSync;
  view: WorkspaceView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run } = useWorkspaceAction();
  const [userId, setUserId] = useState("");
  const candidates = view.people.filter((person) => person.member.role !== "owner");
  const chosen = candidates.find((person) => person.member.user_id === userId);
  return (
    <WriteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setUserId("");
        onOpenChange(next);
      }}
      title={`Hand over ${view.workspace.name}`}
      description="The new owner governs the workspace, including deleting it. You stay on as an admin. Someone who already owns a workspace can't take a second one."
      submitLabel="Hand over"
      canSubmit={chosen !== undefined}
      onSubmit={() =>
        run("Couldn't hand over the workspace", () =>
          sync.write("transferOwnership", { organizationId: view.workspace.id, userId }),
        )
      }
    >
      <div className="grid gap-1.5">
        <Label>New owner</Label>
        <Select value={userId} onValueChange={(value) => setUserId(value ?? "")}>
          <SelectTrigger aria-label="New owner">
            <SelectValue>
              {chosen ? (chosen.person?.name ?? chosen.person?.email) : "Choose someone"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {candidates.map(({ member, person }) => (
              <SelectItem hideIndicator key={member.id} value={member.user_id}>
                {person?.name || person?.email || "Someone"}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </WriteDialog>
  );
}

export function NewWorkspaceDialog({
  sync,
  open,
  onOpenChange,
  onCreated,
}: {
  sync: WorkspaceSync;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}) {
  const { run } = useWorkspaceAction();
  const [name, setName] = useState("");
  return (
    <WriteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("");
        onOpenChange(next);
      }}
      title="New workspace"
      description="Your workspace holds the people you work with and their teams. It starts with one team of the same name, which you own."
      submitLabel="Create workspace"
      canSubmit={name.trim().length > 0}
      onSubmit={async () => {
        // A short random suffix keeps two workspaces of the same name apart.
        const slug = `${slugFor(name)}-${randomUUID().slice(0, 4)}`;
        const done = await run("Couldn't create the workspace", () =>
          sync.write("createWorkspace", { name: name.trim(), slug }),
        );
        if (done) onCreated(slug);
        return done;
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="workspace-name">Name</Label>
        <Input
          id="workspace-name"
          value={name}
          maxLength={80}
          placeholder="Your company or project"
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </div>
    </WriteDialog>
  );
}
