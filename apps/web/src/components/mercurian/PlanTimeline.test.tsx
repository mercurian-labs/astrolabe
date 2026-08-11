import {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanTurnId,
  type ChatAttachment,
  type PlanInFlightTurn,
  type PlanQuestion,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { PlanTimeline } from "./PlanTimeline";

vi.mock("../../assets/assetUrls", () => ({
  useAssetUrl: () => "/assets/attachment-1",
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "environment-test",
}));

type PlanMessage = Extract<PlanTimelineItem, { readonly _tag: "message" }>;

const CREATED_AT = "2026-08-03T12:34:56.000Z";
const id = (value: string) => MercurianCommitId.make(value);

function message(
  commitId: string,
  authorKind: PlanMessage["authorKind"],
  text: string,
  overrides: Partial<PlanMessage> = {},
): PlanMessage {
  return {
    _tag: "message",
    commitId: id(commitId),
    sequence: 1,
    parents: [],
    published: false,
    authorKind,
    text,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

const question: PlanQuestion = {
  id: "surface",
  header: "Scope",
  question: "Which surface first?",
  options: [
    { label: "Web", description: "The browser app" },
    { label: "Mobile", description: "The phone app" },
  ],
};

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
          message("human-1", "human", "Inspect @README.md next", {
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
      'class="rounded bg-muted/70 px-1 py-0.5 font-medium text-foreground">README.md</span>',
    );
    expect(markup).not.toContain("rounded-lg border");
    expect(markup).not.toContain(">You<");
  });

  it("renders assistant messages as full-width markdown with grounding before the body", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          message("assistant-1", "assistant", "A **bold** answer", {
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
          message("assistant-interrupted", "assistant", "Partial reply", {
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

  it("keeps plan revisions and imported issues in their existing shapes", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          {
            _tag: "issue-revision",
            commitId: id("issue-1"),
            sequence: 1,
            parents: [],
            published: false,
            authorKind: "human",
            createdAt: CREATED_AT,
            title: "Imported title",
            description: "Imported description",
          },
          {
            _tag: "plan-revision",
            commitId: id("revision-1"),
            sequence: 2,
            parents: [id("issue-1")],
            published: false,
            authorKind: "human",
            createdAt: CREATED_AT,
          },
        ]}
      />,
    );

    expect(markup).toContain('class="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"');
    expect(markup).toContain("Imported issue");
    expect(markup).toContain("Imported title");
    expect(markup).toContain(
      'class="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/70"',
    );
    expect(markup).toContain("You edited the plan");
  });

  it("distinguishes settled question records from in-flight question cards", () => {
    const settledMarkup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          message("assistant-question", "assistant", "I need a choice.", {
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
        timeline={[message("assistant-plain", "assistant", "Plain reply")]}
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

  it("labels split revisions with their repository", () => {
    const markup = renderToStaticMarkup(
      <PlanTimeline
        timeline={[
          {
            _tag: "plan-revision",
            commitId: id("split-1"),
            sequence: 1,
            parents: [],
            published: false,
            authorKind: "human",
            createdAt: CREATED_AT,
            split: {
              repositoryId: MercurianRepositoryId.make("repo-server"),
              repositoryName: "server",
            },
          },
        ]}
      />,
    );
    expect(markup).toContain("You split the plan for server");
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
    expect(markup).toContain("Working out where this plan implements…");
    expect(markup).toContain("Consulted 1 item…");
    expect(markup).toContain(">Stop</button>");
  });
});
