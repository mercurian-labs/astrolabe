import {
  createReactNativeRuntimeVisibilityAdapter,
  createWorkspaceSync,
  type WorkspaceRows,
  type WorkspaceSync,
  WorkspaceWriteRefused,
} from "@t3tools/client-runtime/workspaces";
import { useLiveQuery } from "@tanstack/react-db";
import { createExpoSQLitePersistence } from "@tanstack/expo-db-sqlite-persistence";
import * as ExpoCrypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { cloudConnection, useCloudAccountState } from "../cloud/account";

// TanStack DB names every transaction, and SQLite persistence every row
// batch, with globalThis.crypto, which Hermes doesn't have; without it every
// optimistic write throws and nothing is saved. expo-crypto supplies both
// synchronously. Installed only where missing.
const cryptoGlobal = ((globalThis as { crypto?: Partial<Crypto> }).crypto ??= {});
cryptoGlobal.getRandomValues ??= ExpoCrypto.getRandomValues as Crypto["getRandomValues"];
cryptoGlobal.randomUUID ??= ExpoCrypto.randomUUID as Crypto["randomUUID"];

// Electric only needs to know whether the app is in front.
const appVisibility: Parameters<typeof createReactNativeRuntimeVisibilityAdapter>[0] = {
  get currentState() {
    return AppState.currentState === "active" ? "active" : "background";
  },
  addEventListener: (type, listener) =>
    AppState.addEventListener(type, (state) =>
      listener(state === "active" ? "active" : "background"),
    ),
};

interface Session {
  readonly userId: string;
  readonly sync: WorkspaceSync;
  /** A fresh set of collections over the same database. */
  readonly build: () => WorkspaceSync;
  readonly database: SQLite.SQLiteDatabase | null;
}

let session: Session | null = null;
let opening: string | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

// One file per person, deleted when they sign out, so nobody else's
// workspace data stays on the phone.
const databaseName = (userId: string) => `astrolabe-workspaces-${userId}.db`;
// Whose database is on the phone, so a sign-out noticed after a restart can
// still delete it.
const SAVED_FOR_KEY = "astrolabe.workspaces-saved-for";

const forgetSaved = async (userId: string) => {
  await SQLite.deleteDatabaseAsync(databaseName(userId)).catch(() => undefined);
  if ((await SecureStore.getItemAsync(SAVED_FOR_KEY)) === userId) {
    await SecureStore.deleteItemAsync(SAVED_FOR_KEY);
  }
};

const end = async (ended: Session, signedOut: boolean) => {
  await ended.sync.close().catch(() => undefined);
  await ended.database?.closeAsync().catch(() => undefined);
  if (signedOut) await forgetSaved(ended.userId);
};

/**
 * Opens the signed-in person's workspace collections, saved in SQLite so the
 * app opens with them and resumes each shape where it left off. Without a
 * database (it failed to open) they sync in memory instead.
 */
function follow(userId: string | null) {
  if (session !== null && session.userId !== userId) {
    const ended = session;
    session = null;
    notify();
    void end(ended, true);
  }
  if (userId === null || session !== null || opening === userId) return;
  opening = userId;
  void SQLite.openDatabaseAsync(databaseName(userId))
    .then(async (database) => {
      await SecureStore.setItemAsync(SAVED_FOR_KEY, userId);
      return { database, persistence: createExpoSQLitePersistence({ database }) };
    })
    .catch((error: unknown) => {
      console.warn("Workspaces sync without saving to the phone", error);
      return { database: null, persistence: undefined };
    })
    .then(({ database, persistence }) => {
      const connection = cloudConnection();
      if (opening !== userId || connection === null) {
        void database?.closeAsync();
        return;
      }
      opening = null;
      const build = () =>
        createWorkspaceSync({
          connection,
          userId,
          runtimeVisibility: createReactNativeRuntimeVisibilityAdapter(appVisibility),
          ...(persistence ? { persistence } : {}),
        });
      session = { userId, database, build, sync: build() };
      notify();
    });
}

/**
 * Deletes saved workspaces that don't belong to whoever is signed in: on
 * sign-out, on switching accounts, and after a restart that finds someone
 * else's (or nobody's) session. Mounted at the app root, since sign-out
 * rarely happens on the Workspaces screen.
 */
export function useWorkspaceDataCleanup(): void {
  const account = useCloudAccountState();
  const userId = account.status === "signedIn" ? account.user.id : null;
  useEffect(() => {
    if (account.status === "loading") return;
    if (session !== null && session.userId !== userId) {
      const ended = session;
      session = null;
      notify();
      void end(ended, true);
    }
    void SecureStore.getItemAsync(SAVED_FOR_KEY).then((saved) => {
      if (saved !== null && saved !== userId && session?.userId !== saved) {
        void forgetSaved(saved);
      }
    });
  }, [account.status, userId]);
}

/**
 * The open session, its collections replaced if they stopped while nobody
 * read them (see `WorkspaceSync.stopped`). Idempotent, so it serves as the
 * store's snapshot.
 */
const currentSession = (): Session | null => {
  if (session?.sync.stopped) {
    const stopped = session;
    session = { ...stopped, sync: stopped.build() };
    void stopped.sync.close();
  }
  return session;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The signed-in person's workspace collections, or null while signed out or opening. */
export function useWorkspaceSync(): WorkspaceSync | null {
  const account = useCloudAccountState();
  const userId = account.status === "signedIn" ? account.user.id : null;
  useEffect(() => {
    // Loading isn't signed out: keep the saved data until the session is known.
    if (account.status !== "loading") follow(userId);
  }, [account.status, userId]);
  const current = useSyncExternalStore(subscribe, currentSession);
  return current !== null && current.userId === userId ? current.sync : null;
}

const NONE: ReadonlyArray<never> = [];

/** Every workspace row synced to this device; collections sync only while read. */
export function useWorkspaceRows(sync: WorkspaceSync | null): {
  readonly rows: WorkspaceRows;
  readonly ready: boolean;
} {
  const c = sync?.collections;
  const workspaces = useLiveQuery((q) => (c ? q.from({ row: c.workspaces }) : null), [c]);
  const members = useLiveQuery((q) => (c ? q.from({ row: c.members }) : null), [c]);
  const people = useLiveQuery((q) => (c ? q.from({ row: c.people }) : null), [c]);
  const teams = useLiveQuery((q) => (c ? q.from({ row: c.teams }) : null), [c]);
  const teamMembers = useLiveQuery((q) => (c ? q.from({ row: c.teamMembers }) : null), [c]);
  const teamOwners = useLiveQuery((q) => (c ? q.from({ row: c.teamOwners }) : null), [c]);
  const invitations = useLiveQuery((q) => (c ? q.from({ row: c.invitations }) : null), [c]);
  return {
    rows: {
      workspaces: workspaces.data ?? NONE,
      members: members.data ?? NONE,
      people: people.data ?? NONE,
      teams: teams.data ?? NONE,
      teamMembers: teamMembers.data ?? NONE,
      teamOwners: teamOwners.data ?? NONE,
      invitations: invitations.data ?? NONE,
    },
    ready: workspaces.isReady === true && members.isReady === true,
  };
}

/** Runs a workspace write with a pending state, and says why the cloud refused it. */
export function useWorkspaceAction() {
  const [pending, setPending] = useState(false);
  // No `finally`: the React Compiler can't compile a try with a finalizer.
  const run = async (title: string, action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
    } catch (error) {
      setPending(false);
      Dialog.alert(
        title,
        error instanceof WorkspaceWriteRefused
          ? error.message
          : "Astrolabe couldn't reach the cloud. Try again.",
      );
      return false;
    }
    setPending(false);
    return true;
  };
  return { pending, run };
}
