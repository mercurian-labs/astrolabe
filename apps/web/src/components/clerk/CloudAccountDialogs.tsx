import { LogOutIcon, UserRoundIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  cancelCloudSignIn,
  type CloudAccountUser,
  deleteCloudAccount,
  openCloudAccountSettings,
  openCloudSignInPage,
  signOutCloudAccount,
  startCloudSignIn,
  useCloudAccountState,
} from "../../cloud/account";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
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
import { toastManager } from "../ui/toast";
import { ClerkUserProfilePage } from "./ClerkUserProfilePage";
import {
  type CloudAccountPage,
  setOpenCloudAccountPage as setOpenPage,
  T3_CONNECT_ACCOUNT_PAGES,
  useOpenCloudAccountPage as useOpenPage,
} from "./T3ConnectAccountPages";

/** The account dialog and the device-code sign-in prompt, mounted once at the root. */
export function CloudAccountDialogs() {
  if (!hasCloudPublicConfig()) return null;
  return (
    <>
      <CloudSignInDialog />
      <CloudAccountDialog />
    </>
  );
}

function CloudSignInDialog() {
  const account = useCloudAccountState();
  const deviceSignIn = account.status === "signedOut" ? account.deviceSignIn : null;
  return (
    <Dialog
      open={deviceSignIn !== null}
      onOpenChange={(open) => {
        if (!open) cancelCloudSignIn();
      }}
    >
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to Astrolabe</DialogTitle>
          <DialogDescription>
            Approve this code at app.astrolabe.sh/device. Astrolabe signs in as soon as you do.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          <p
            aria-label="Sign-in code"
            className="rounded-xl border border-border/70 bg-muted/35 py-4 text-center font-mono text-2xl tracking-widest text-foreground"
          >
            {deviceSignIn?.userCode}
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={cancelCloudSignIn}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (deviceSignIn) openCloudSignInPage(deviceSignIn.verificationUrl);
            }}
          >
            Open sign-in page
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function CloudAccountDialog() {
  const account = useCloudAccountState();
  const page = useOpenPage();
  const user = account.status === "signedIn" ? account.user : null;
  const pages: ReadonlyArray<{
    readonly url: CloudAccountPage;
    readonly label: string;
    readonly icon: ReactNode;
  }> = [
    { url: "account", label: "Account", icon: <UserRoundIcon className="size-4" /> },
    ...T3_CONNECT_ACCOUNT_PAGES,
  ];
  const current = T3_CONNECT_ACCOUNT_PAGES.find((entry) => entry.url === page);

  return (
    <Dialog
      open={page !== null && user !== null}
      onOpenChange={(open) => {
        if (!open) setOpenPage(null);
      }}
    >
      <DialogPopup className="max-w-3xl">
        <div className="flex min-h-0 flex-col sm:flex-row">
          <nav aria-label="Account" className="flex shrink-0 gap-1 p-3 sm:w-48 sm:flex-col">
            {pages.map((entry) => (
              <Button
                key={entry.url}
                variant={entry.url === page ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => setOpenPage(entry.url)}
              >
                {entry.icon}
                {entry.label}
              </Button>
            ))}
          </nav>
          <DialogPanel className="min-w-0 flex-1">
            {current ? current.content : user ? <AccountPage user={user} /> : null}
          </DialogPanel>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function AccountPage({ user }: { readonly user: CloudAccountUser }) {
  const onWaitlist = user.access === "waitlisted" || user.access === "declined";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <ClerkUserProfilePage
      title={user.name || user.email}
      description={user.name ? user.email : undefined}
    >
      <div className="flex flex-col gap-4">
        {onWaitlist ? (
          <p className="rounded-xl border border-border/70 bg-muted/35 p-3 text-sm text-muted-foreground">
            You're on the waitlist. T3 Connect turns on once your account is approved, and we'll
            email you when it is.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openCloudAccountSettings}>
            Manage sign-in methods
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setOpenPage(null);
              void signOutCloudAccount();
            }}
          >
            <LogOutIcon />
            Sign out
          </Button>
          <Button variant="destructive-outline" onClick={() => setConfirmingDelete(true)}>
            {onWaitlist ? "Leave the waitlist" : "Delete account"}
          </Button>
        </div>
      </div>
      <DeleteAccountDialog
        open={confirmingDelete}
        onWaitlist={onWaitlist}
        onClose={() => setConfirmingDelete(false)}
      />
    </ClerkUserProfilePage>
  );
}

function DeleteAccountDialog({
  open,
  onWaitlist,
  onClose,
}: {
  readonly open: boolean;
  readonly onWaitlist: boolean;
  readonly onClose: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [problem, setProblem] = useState<"sign-in-again" | string | null>(null);

  const confirm = async () => {
    setIsDeleting(true);
    const result = await deleteCloudAccount().catch(
      (): { readonly _tag: "Failed"; readonly message: string } => ({
        _tag: "Failed",
        message: "Your account could not be deleted. Check your connection and try again.",
      }),
    );
    setIsDeleting(false);
    switch (result._tag) {
      case "Deleted":
        onClose();
        setOpenPage(null);
        toastManager.add({
          type: "success",
          title: onWaitlist ? "You've left the waitlist" : "Account deleted",
          description: "Your Astrolabe account and its data are gone.",
        });
        return;
      case "SignInAgain":
        setProblem("sign-in-again");
        return;
      case "OwnsSharedOrganization":
        setProblem(
          "You own an organization with other members. Hand it over or remove them first.",
        );
        return;
      case "Failed":
        setProblem(result.message);
        return;
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isDeleting) {
          setProblem(null);
          onClose();
        }
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {onWaitlist ? "Leave the waitlist?" : "Delete your Astrolabe account?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {onWaitlist
              ? "This deletes your account and gives up your place on the list."
              : "This deletes your account, unlinks your machines from T3 Connect, and removes this account from your phones. Organizations you own alone are deleted too. It can't be undone."}
          </AlertDialogDescription>
          {problem === "sign-in-again" ? (
            <AlertDialogDescription>
              For your security, sign in again before deleting your account.
            </AlertDialogDescription>
          ) : problem ? (
            <AlertDialogDescription>{problem}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={isDeleting} />}>
            Cancel
          </AlertDialogClose>
          {problem === "sign-in-again" ? (
            <Button
              onClick={() => {
                setProblem(null);
                onClose();
                setOpenPage(null);
                void signOutCloudAccount().then(startCloudSignIn);
              }}
            >
              Sign in again
            </Button>
          ) : (
            <Button variant="destructive" disabled={isDeleting} onClick={() => void confirm()}>
              {onWaitlist ? "Leave the waitlist" : "Delete account"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
