import type { EnvironmentId, WikiSummary } from "@t3tools/contracts";
import { wikiAgentGuidance } from "@t3tools/contracts";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { ensureLocalApi } from "~/localApi";
import { useEnvironments } from "~/state/environments";
import { wikiEnvironment } from "~/state/wiki";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useOpenWiki } from "../wiki/useOpenWiki";
import { describeIndexError, summarizeMirror, type MirrorTone } from "../wiki/wiki.logic";
import { WikiMirrorDialog } from "../wiki/WikiDialogs";
import { useWikiCommand, useWikiOverviews } from "../wiki/wikiEnvironment";
import { WikiProjectLinks } from "../wiki/WikiLinks";
import { closeWikiTabs } from "../wiki/wikiPanes";
import { WikiPart } from "../wiki/WikiParts";
import { wikiScopeKey } from "../wiki/wikiTabs";
import { useRepositories } from "../repositories/useRepositories";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const MIRROR_BADGE: Record<MirrorTone, "outline" | "success" | "warning" | "error" | "secondary"> =
  {
    none: "outline",
    ok: "success",
    pending: "secondary",
    warning: "warning",
    error: "error",
  };

function WikiMirrorBadge({ wiki }: { readonly wiki: WikiSummary }) {
  const summary = summarizeMirror(wiki.mirror, formatRelativeTimeLabel);
  if (summary.tone === "none") return null;
  return <Badge variant={MIRROR_BADGE[summary.tone]}>{summary.label}</Badge>;
}

function FactRow({ title, value }: { readonly title: string; readonly value: string | number }) {
  return (
    <SettingsRow
      title={title}
      control={<span className="text-sm text-muted-foreground tabular-nums">{value}</span>}
    />
  );
}

function WikiListRow({
  overview,
  serverLabel,
}: {
  readonly overview: WikiOverview;
  readonly serverLabel: string | null;
}) {
  const { environmentId, wiki, index } = overview;
  const projects = useRepositories()
    .filter(
      (project) => project.environmentId === environmentId && wiki.projectIds.includes(project.id),
    )
    .map((project) => project.title);
  const links =
    projects.length === 0 ? "Not linked to a project" : `Linked to ${projects.join(", ")}`;
  const problems = index?.errors.length ?? 0;
  return (
    <SettingsRow
      title={wiki.name}
      description={serverLabel === null ? links : `${serverLabel} · ${links}`}
      status={
        <span className="flex flex-wrap items-center gap-1.5">
          <WikiMirrorBadge wiki={wiki} />
          {problems > 0 ? <Badge variant="warning">Needs attention</Badge> : null}
        </span>
      }
      control={
        <Button
          size="xs"
          variant="outline"
          render={
            <Link
              to="/settings/wikis"
              search={{ wiki: wikiScopeKey(environmentId, wiki.wikiId) }}
            />
          }
        >
          Manage
        </Button>
      }
    />
  );
}

function WikiList({ overviews }: { readonly overviews: ReadonlyArray<WikiOverview> }) {
  const { environments } = useEnvironments();
  const labelOf = (environmentId: EnvironmentId) =>
    environments.length < 2
      ? null
      : (environments.find((environment) => environment.environmentId === environmentId)?.label ??
        null);
  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Wikis"
        headerAction={
          <Button
            size="xs"
            variant="outline"
            onClick={() => openCommandPalette({ open: "add-wiki" })}
          >
            <PlusIcon />
            Add a wiki
          </Button>
        }
      >
        {overviews.length === 0 ? (
          <SettingsRow
            title="No wikis yet"
            description="A wiki is a folder of linked notes that you and your agents keep together."
          />
        ) : (
          overviews.map((overview) => (
            <WikiListRow
              key={wikiScopeKey(overview.environmentId, overview.wiki.wikiId)}
              overview={overview}
              serverLabel={labelOf(overview.environmentId)}
            />
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function BackToWikis() {
  return (
    <div>
      <Button size="xs" variant="ghost" render={<Link to="/settings/wikis" />}>
        <ArrowLeftIcon />
        All wikis
      </Button>
    </div>
  );
}

function WikiPage({ overview }: { readonly overview: WikiOverview }) {
  const { environmentId, wiki, index } = overview;
  const navigate = useNavigate();
  const openWiki = useOpenWiki();
  const canPush = useAtomValue(wikiEnvironment.pushMirror.permissionAtom(environmentId));
  const canRemove = useAtomValue(wikiEnvironment.remove.permissionAtom(environmentId));
  const pushMirror = useWikiCommand(wikiEnvironment.pushMirror, "Couldn't push to the mirror");
  const remove = useWikiCommand(wikiEnvironment.remove, "Couldn't remove the wiki");
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const mirror = summarizeMirror(wiki.mirror, formatRelativeTimeLabel);
  const errors = (index?.errors ?? []).map(describeIndexError);

  const removeWiki = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Remove “${wiki.name}” from Astrolabe? Its folder and git history stay on disk at ${wiki.root}; you can add the folder again later.`,
      { variant: "destructive" },
    );
    if (!confirmed) return;
    const outcome = await remove({ environmentId, input: { wikiId: wiki.wikiId } });
    if (!outcome.ok) return;
    closeWikiTabs((tab) => tab.environmentId === environmentId && tab.wikiId === wiki.wikiId);
    await navigate({ to: "/settings/wikis" });
  };

  return (
    <SettingsPageContainer>
      <BackToWikis />
      {errors.length > 0 ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>Needs attention</AlertTitle>
          <AlertDescription>
            <WikiPart.ErrorList errors={errors} />
          </AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection
        title={wiki.name}
        headerAction={
          <Button
            size="xs"
            variant="outline"
            onClick={() => void openWiki(environmentId, wiki.wikiId)}
          >
            Open wiki
          </Button>
        }
      >
        <SettingsRow title="Folder" description={<span className="break-all">{wiki.root}</span>} />
        <FactRow title="Main line" value={wiki.mainBranch} />
        <FactRow
          title="Documents"
          value={index === null ? "…" : index.notes.length + index.bases.length}
        />
        <FactRow title="Open change requests" value={wiki.openChangeRequests} />
      </SettingsSection>
      <WikiProjectLinks environmentId={environmentId} wiki={wiki} />
      <FoldedSettingsSection id="wiki-agent-guidance" title="What agents are told">
        <SettingsRow
          title="Told to a linked project's agents"
          description={wikiAgentGuidance([wiki.name])}
        />
        <SettingsRow
          title="When they hear it"
          description="A new thread hears it with its first message. A thread that already exists hears it with its next message, never during a turn."
        />
        <SettingsRow
          title="Without a link"
          description="Agents can reach any wiki through their tools. A link is what tells them to look here first. Unlinking stops new threads hearing about it; a thread that already heard keeps what it knows."
        />
      </FoldedSettingsSection>
      <SettingsSection
        title="Mirror"
        headerAction={
          <div className="flex items-center gap-2">
            {wiki.mirror ? (
              <Button
                size="xs"
                variant="outline"
                disabled={!canPush}
                onClick={() => void pushMirror({ environmentId, input: { wikiId: wiki.wikiId } })}
              >
                Push now
              </Button>
            ) : null}
            <Button size="xs" variant="outline" onClick={() => setMirrorOpen(true)}>
              {wiki.mirror ? "Edit" : "Set up a mirror"}
            </Button>
          </div>
        }
      >
        <SettingsRow
          title={wiki.mirror ? <span className="break-all">{wiki.mirror.url}</span> : mirror.label}
          description="After every merge, the main line and its history are pushed here. It is a copy: changes made on it directly are replaced by the next push."
          status={<WikiMirrorBadge wiki={wiki} />}
        />
      </SettingsSection>
      {wiki.mirror?.lastError ? (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertTitle>The last push to the mirror failed</AlertTitle>
          <AlertDescription>{wiki.mirror.lastError}</AlertDescription>
        </Alert>
      ) : null}
      {mirror.tone === "warning" ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>A push overwrote the mirror</AlertTitle>
          <AlertDescription>
            Commits made on the mirror directly were replaced by this wiki's main line.
          </AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection title="Danger">
        <SettingsRow
          title="Remove wiki"
          description="Removes it from Astrolabe. Its folder and git history stay on disk."
          control={
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={!canRemove}
              onClick={() => void removeWiki()}
            >
              Remove wiki
            </Button>
          }
        />
      </SettingsSection>
      {mirrorOpen ? (
        <WikiMirrorDialog
          environmentId={environmentId}
          wiki={wiki}
          open
          onOpenChange={setMirrorOpen}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

/** Settings → Wikis: every wiki, or one wiki's page when `wikiKey` names it. */
export function WikisSettings({ wikiKey }: { readonly wikiKey: string | undefined }) {
  const { overviews, loading } = useWikiOverviews();
  if (wikiKey === undefined) return <WikiList overviews={overviews} />;
  const overview = overviews.find(
    (candidate) => wikiScopeKey(candidate.environmentId, candidate.wiki.wikiId) === wikiKey,
  );
  if (overview !== undefined) return <WikiPage key={wikiKey} overview={overview} />;
  return (
    <SettingsPageContainer>
      <BackToWikis />
      {loading ? null : (
        <p className="text-sm text-muted-foreground">This wiki is no longer available.</p>
      )}
    </SettingsPageContainer>
  );
}
