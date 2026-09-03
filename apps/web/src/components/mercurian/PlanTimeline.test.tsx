import {
  MercurianRepositoryId,
  PlanTurnId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ChatAttachment,
  type PlanInFlightTurn,
  type PlanQuestion,
  type PlanTimelineItem,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { planCodingSessionRecord, planQuestion } from "../../test/fixtures/sessionsAndSplits";
import {
  codingSessionLeaf,
  commitId as id,
  message,
  planRevision,
  specRevision,
} from "../../test/fixtures/timeline";

import { PlanTimeline } from "./PlanTimeline";

vi.mock("../../assets/assetUrls", () => ({
  useAssetUrl: () => "/assets/attachment-1",
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "environment-test",
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      ...props
    }: Omit<ComponentProps<"a">, "href"> & {
      readonly to: string;
      readonly params?: Readonly<Record<string, string>>;
    }) => (
      <a {...props} href={to.replace(/\$(\w+)/g, (_match, key: string) => params?.[key] ?? "")} />
    ),
  };
});

type PlanMessage = Extract<PlanTimelineItem, { readonly _tag: "message" }>;

const CREATED_AT = "2026-08-03T12:34:56.000Z";
const claude = ProviderDriverKind.make("claudeAgent");
const skills: ReadonlyArray<ServerProviderSkill> = [
  {
    name: "product-docs",
    displayName: "Product Docs",
    path: "/skills/product-docs/SKILL.md",
    enabled: true,
  },
];

const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: claude,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: CREATED_AT,
    models: [{ slug: "opus", name: "Opus", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  },
];

function timelineMessage(
  commitId: string,
  authorKind: PlanMessage["authorKind"],
  text: string,
  overrides: Partial<PlanMessage> = {},
): PlanMessage {
  const { commitId: _commitId, parents, ...fields } = overrides;
  return message(commitId, {
    authorKind,
    text,
    createdAt: CREATED_AT,
    ...fields,
    ...(parents === undefined ? {} : { parents: parents.map(String) }),
  });
}

const question: PlanQuestion = planQuestion("surface", {
  header: "Scope",
  question: "Which surface first?",
  options: [
    { label: "Web", description: "The browser app" },
    { label: "Mobile", description: "The phone app" },
  ],
});

function inFlight(overrides: Partial<PlanInFlightTurn> = {}): PlanInFlightTurn {
  return {
    turnId: PlanTurnId.make("turn-1"),
    parentCommitId: id("parent-1"),
    text: "",
    grounding: [],
    ...overrides,
  };
}

describe("PlanTimeline", () => {
  it("renders human messages as right-aligned bubbles with attachments and mention chips", () => {
    const attachment: ChatAttachment = {
      type: "image",
      id: "attachment-1" as ChatAttachment["id"],
      name: "plan.png",
      mimeType: "image/png",
      sizeBytes: 128,
    };
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          timelineMessage("human-1", "human", "Inspect @README.md next", {
            attachments: [attachment],
          }),
        ]}
      />,
    );

    expect(markup).toContain('class="group flex flex-col items-end gap-1"');
    expect(markup).toContain(
      'class="relative max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground"',
    );
    expect(markup).toContain('src="/assets/attachment-1"');
    expect(markup).toContain('alt="plan.png"');
    expect(markup).toContain(
      'class="inline-flex items-center gap-1 rounded bg-muted/70 px-1 py-0.5 font-medium text-foreground">README.md</span>',
    );
    expect(markup).not.toContain("rounded-lg border");
    expect(markup).not.toContain(">You<");
  });

  it("renders known human-message skills as chips and leaves unknown skills as text", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        skills={skills}
        timeline={[
          timelineMessage("human-skill", "human", "Use $product-docs and $not-installed next"),
        ]}
      />,
    );

    expect(markup).toContain('data-markdown-copy="$product-docs"');
    expect(markup).toContain(">Product Docs</span>");
    expect(markup).toContain("$not-installed");
    expect(markup).not.toContain('data-markdown-copy="$not-installed"');
  });

  it("renders planning note tokens as distinct clickable chips without changing other text", () => {
    const onOpenNote = vi.fn();
    const markup = renderToStaticMarkup(
      <PlanTimeline
        onOpenNote={onOpenNote}
        timeline={[
          timelineMessage("human-note", "human", "Read [[Planning Space]] and @README.md next"),
        ]}
      />,
    );
    expect(markup).toContain("Planning Space</button>");
    expect(markup).toContain("README.md</span>");
    expect(markup).not.toContain("[[Planning Space]]");

    const plain = renderToStaticMarkup(
      <PlanTimeline
        timeline={[timelineMessage("human-note-plain", "human", "Read [[Planning Space]]")]}
      />,
    );
    expect(plain).toContain("Planning Space</span>");
    expect(plain).not.toContain("Planning Space</button>");
  });

  it("renders assistant messages as full-width markdown with grounding before the body", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          timelineMessage("assistant-1", "assistant", "A **bold** answer", {
            groundingScope: { unreachableRepositories: ["mobile"] },
            grounding: [{ kind: "file-read", label: "apps/web/src/App.tsx" }],
          }),
        ]}
      />,
    );

    expect(markup).toContain('class="group/assistant relative min-w-0 px-1 py-0.5"');
    expect(markup).toContain('class="chat-markdown');
    expect(markup).toContain("A <strong>bold</strong> answer");
    expect(markup.indexOf("Grounded without mobile")).toBeLessThan(
      markup.indexOf("Consulted 1 item"),
    );
    expect(markup.indexOf("Consulted 1 item")).toBeLessThan(markup.indexOf("<strong>bold"));
    expect(markup).not.toContain("rounded-lg border");
    expect(markup).not.toContain(">Assistant<");
  });

  it("keeps interrupted marks visible outside the hover-only assistant controls", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          timelineMessage("assistant-interrupted", "assistant", "Partial reply", {
            interrupted: true,
          }),
        ]}
      />,
    );

    const interruptedTextIndex = markup.indexOf(">Interrupted</span>");
    const interruptedTagIndex = markup.lastIndexOf("<span", interruptedTextIndex);
    const interruptedTag = markup.slice(interruptedTagIndex, interruptedTextIndex);

    expect(interruptedTextIndex).toBeGreaterThan(-1);
    expect(interruptedTag).toContain("bg-amber-500/15");
    expect(interruptedTag).not.toContain("opacity-0");
    expect(markup.indexOf("group-hover/assistant:opacity-100")).toBeLessThan(interruptedTagIndex);
  });

  it("attributes assistant replies to their recorded provider and model only when present", () => {
    const attributed = renderToStaticMarkup(
      <PlanTimeline
        providers={providers}
        timeline={[
          timelineMessage("assistant-attributed", "assistant", "Recorded reply", {
            generatedBy: { provider: claude, model: "opus" },
          }),
        ]}
      />,
    );
    const historical = renderToStaticMarkup(
      <PlanTimeline
        providers={providers}
        timeline={[timelineMessage("assistant-old", "assistant", "Old")]}
      />,
    );

    expect(attributed).toContain("Claude · Opus");
    expect(historical).not.toContain("Claude · Opus");

    // The attribution lives inside the same hover-revealed row as the copy
    // action and timestamp. The slice starts inside the row's opening tag, so
    // staying inside means no surplus of closing divs before the attribution;
    // escaping the row would close it first (closed > opened).
    const hoverIndex = attributed.indexOf("group-hover/assistant:opacity-100");
    const attributionIndex = attributed.indexOf("Claude · Opus");
    expect(hoverIndex).toBeGreaterThan(-1);
    expect(attributed.indexOf('aria-label="Copy link"')).toBeGreaterThan(hoverIndex);
    const upToAttribution = attributed.slice(hoverIndex, attributionIndex);
    const opened = upToAttribution.split("<div").length - 1;
    const closed = upToAttribution.split("</div>").length - 1;
    expect(opened).toBeGreaterThanOrEqual(closed);
  });

  it("renders plan and spec revisions as compact artifact events", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          specRevision("issue-1", {
            createdAt: CREATED_AT,
            cause: "import",
            issueId: "M-101",
          }),
          planRevision("revision-1", {
            sequence: 2,
            parents: ["issue-1"],
            createdAt: CREATED_AT,
          }),
        ]}
      />,
    );

    expect(markup).toContain("Spec imported from M-101");
    expect(markup).toContain(
      'class="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/70"',
    );
    expect(markup).toContain("You edited the plan");
  });

  it("renders a memory amendment stamp as a compact event instead of a message bubble", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          timelineMessage("memory-amendment", "human", "Surface open decisions", {
            memoryAmendment: {
              title: "Surface open decisions",
              memoryCommitSha: "abc123",
              notes: ["Composer"],
            },
          }),
        ]}
      />,
    );

    expect(markup).toContain("You amended the memory: &quot;Surface open decisions&quot;");
    expect(markup).toContain("text-[11px] text-muted-foreground/70");
    expect(markup).not.toContain("rounded-2xl bg-message");
  });

  it("distinguishes settled question records from in-flight question cards", () => {
    const settledMarkup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          timelineMessage("assistant-question", "assistant", "I need a choice.", {
            question: { questions: [question], answers: { surface: "Web" } },
          }),
        ]}
      />,
    );
    const inFlightMarkup = renderToStaticMarkup(
      <PlanTimeline timeline={[]} inFlight={inFlight({ questions: [question] })} />,
    );

    expect(settledMarkup).toContain("Which surface first?");
    expect(settledMarkup).toContain(">Web</p>");
    expect(settledMarkup).not.toContain(">Answer</button>");
    expect(inFlightMarkup).toContain("waiting on you");
    expect(inFlightMarkup).toContain("The browser app");
    expect(inFlightMarkup).toContain(">Answer</button>");
  });

  it("renders the streaming status, live markdown, and collapsed live grounding fold", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[]}
        inFlight={inFlight({
          text: "Streaming **now**",
          grounding: [{ kind: "search", label: "planning timeline" }],
        })}
      />,
    );

    expect(markup).toContain("replying…");
    expect(markup).toContain("Consulted 1 item…");
    expect(markup).toContain("Streaming <strong>now</strong>");
    expect(markup).not.toContain("planning timeline");
    expect(markup).not.toContain("waiting on you");
  });

  it("does not add thread-only affordances", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[timelineMessage("assistant-plain", "assistant", "Plain reply")]}
        inFlight={inFlight({ text: "Live reply" })}
      />,
    );

    expect(markup).not.toContain('data-testid="timeline-minimap"');
    expect(markup).not.toContain("data-changed-files-state");
    expect(markup).not.toContain("Revert to this message");
    expect(markup).not.toContain("Context window ");
    expect(markup).not.toContain('aria-label="Runtime mode"');
    expect(markup).not.toContain("data-chat-provider-model-picker");
    expect(markup).not.toContain("data-model-picker-content");
  });

  it("labels repository plan revisions in user terms", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          planRevision("split-1", {
            createdAt: CREATED_AT,
            split: {
              repositoryId: "repo-server",
              repositoryName: "server",
            },
          }),
        ]}
      />,
    );
    expect(markup).toContain("You added a plan for server");
  });

  it("badges a ready commit", () => {
    const readyMessage = timelineMessage("ready-1", "human", "Implement this");
    const markup = renderToStaticMarkup(
      <PlanTimeline
        readyCommits={
          new Map([
            [
              readyMessage.commitId,
              {
                commitId: readyMessage.commitId,
                repositoryId: MercurianRepositoryId.make("repo-server"),
                repositoryName: "server",
              },
            ],
          ])
        }
        timeline={[readyMessage]}
      />,
    );
    expect(markup).toContain("Ready to implement");
  });

  it("renders structured coding-session facts without a generated summary", () => {
    const sessionCommit = codingSessionLeaf("session-1", {
      sequence: 3,
      parents: ["revision-abcdef12"],
      createdAt: CREATED_AT,
      repositoryId: "repo-server",
      repositoryName: "server",
      planRevisionCommitId: "revision-abcdef12",
    });
    const session = planCodingSessionRecord("session-1", {
      repositoryId: "repo-server",
      threadId: "thread",
      branch: "mercurian/reshape-sidebar-12345678",
      worktreePath: "/tmp/session",
      baseRef: "main",
      startedAt: CREATED_AT,
      endedAt: "2026-08-03T13:00:00.000Z",
      outcome: "completed",
      prUrl: "https://example.test/pull/1",
      partial: true,
      departedRef: "feature/detour",
    });
    const markup = renderToStaticMarkup(
      <PlanTimeline timeline={[sessionCommit]} codingSessions={[session]} />,
    );
    expect(markup).toContain("Coding session · server");
    expect(markup).toContain("Implemented revision");
    expect(markup).toContain("Completed");
    expect(markup).toContain("Partial");
    expect(markup).toContain("Departed");
    expect(markup).toContain("mercurian/reshape-sidebar-12345678");
    expect(markup).toContain('href="https://example.test/pull/1"');
    expect(markup).toContain('href="/sessions/thread"');
    expect(markup).toContain(">Open session</a>");
    expect(markup).not.toContain('aria-disabled="true"');
    expect(markup).not.toContain("data-disabled");
    expect(markup).not.toContain("summary");

    const missingRecordMarkup = renderToStaticMarkup(
      <PlanTimeline timeline={[sessionCommit]} codingSessions={[]} />,
    );
    expect(missingRecordMarkup).toContain('disabled=""');
    expect(missingRecordMarkup).not.toContain('href="/sessions/');
  });

  it("renders the implement analyzing card with grounding and Stop", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        inFlightImplement={{
          turnId: PlanTurnId.make("implement-turn"),
          parentCommitId: id("parent-1"),
          grounding: [{ kind: "search", label: "repository coverage" }],
        }}
        timeline={[]}
        onStopImplement={() => undefined}
      />,
    );
    expect(markup).toContain("Checking whether this plan is ready to implement.");
    expect(markup).toContain("A coding session works in one repository at a time.");
    expect(markup).toContain("Consulted 1 item…");
    expect(markup).toContain(">Stop</button>");
  });
});
