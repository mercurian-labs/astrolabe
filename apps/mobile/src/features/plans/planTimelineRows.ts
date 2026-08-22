import { planCommitSummary } from "@t3tools/client-runtime/state/plan-graph";
import type {
  PlanCodingSessionRecord,
  PlanInFlightImplement,
  PlanInFlightTurn,
  PlanMessage,
  PlanTimelineItem,
} from "@t3tools/contracts";

export type PlanQuestionState = "none" | "awaiting" | "answered" | "unanswered";

export type PlanTimelineRow =
  | {
      readonly type: "human-message" | "assistant-message";
      readonly key: string;
      readonly item: PlanMessage;
      readonly interrupted: boolean;
      readonly questionState: PlanQuestionState;
    }
  | {
      readonly type: "effect";
      readonly key: string;
      readonly item: Exclude<PlanTimelineItem, { readonly _tag: "message" | "coding-session" }>;
      readonly label: string;
    }
  | {
      readonly type: "coding-session";
      readonly key: string;
      readonly item: Extract<PlanTimelineItem, { readonly _tag: "coding-session" }>;
      readonly record: PlanCodingSessionRecord | null;
      readonly status: string;
    }
  | {
      readonly type: "in-flight-turn";
      readonly key: string;
      readonly turn: PlanInFlightTurn;
      readonly questionState: "none" | "awaiting";
    }
  | {
      readonly type: "in-flight-implement";
      readonly key: string;
      readonly implement: PlanInFlightImplement;
    };

function settledQuestionState(message: PlanMessage): PlanQuestionState {
  if (message.question === undefined) return "none";
  return message.question.answers === undefined ? "unanswered" : "answered";
}

function codingStatus(record: PlanCodingSessionRecord | null): string {
  if (record === null) return "Ended";
  if (record.endedAt === null) return "Running";
  switch (record.outcome) {
    case "completed":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case null:
      return "Ended";
  }
}

export function derivePlanTimelineRows(input: {
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly visibleCommitIds: ReadonlySet<string>;
  readonly inFlightTurn?: PlanInFlightTurn | undefined;
  readonly inFlightImplement?: PlanInFlightImplement | undefined;
  readonly codingSessions?: ReadonlyArray<PlanCodingSessionRecord> | undefined;
}): ReadonlyArray<PlanTimelineRow> {
  const sessions = new Map(
    (input.codingSessions ?? []).map((record) => [record.commitId as string, record]),
  );
  const rows: Array<PlanTimelineRow> = [];
  for (const item of input.timeline) {
    if (!input.visibleCommitIds.has(item.commitId)) continue;
    if (item._tag === "message") {
      rows.push({
        type: item.authorKind === "human" ? "human-message" : "assistant-message",
        key: `commit:${item.commitId}`,
        item,
        interrupted: item.interrupted === true,
        questionState: settledQuestionState(item),
      });
    } else if (item._tag === "coding-session") {
      const record = sessions.get(item.commitId) ?? null;
      rows.push({
        type: "coding-session",
        key: `commit:${item.commitId}`,
        item,
        record,
        status: codingStatus(record),
      });
    } else {
      rows.push({
        type: "effect",
        key: `commit:${item.commitId}`,
        item,
        label: planCommitSummary(item),
      });
    }
  }
  if (
    input.inFlightTurn !== undefined &&
    input.visibleCommitIds.has(input.inFlightTurn.parentCommitId)
  ) {
    rows.push({
      type: "in-flight-turn",
      key: `turn:${input.inFlightTurn.turnId}`,
      turn: input.inFlightTurn,
      questionState:
        input.inFlightTurn.questions !== undefined && input.inFlightTurn.questions.length > 0
          ? "awaiting"
          : "none",
    });
  }
  if (
    input.inFlightImplement !== undefined &&
    input.visibleCommitIds.has(input.inFlightImplement.parentCommitId)
  ) {
    rows.push({
      type: "in-flight-implement",
      key: `implement:${input.inFlightImplement.turnId}`,
      implement: input.inFlightImplement,
    });
  }
  return rows;
}
