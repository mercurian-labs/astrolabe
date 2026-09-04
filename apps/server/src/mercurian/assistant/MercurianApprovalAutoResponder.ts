import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ApprovalAutoResponder } from "../../orchestration/Services/ApprovalAutoResponder.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";

const PLANNING_TOOLS = new Set([
  "save_plan_revision",
  "save_spec_revision",
  "propose_memory_amendment",
  "read_plan",
  "read_spec",
]);
const PREFIXES = ["mcp__t3-code__", "t3-code_"] as const;

export const normalizePlanningToolName = (name: string): string | undefined => {
  const prefix = PREFIXES.find((candidate) => name.startsWith(candidate));
  return prefix === undefined ? undefined : name.slice(prefix.length);
};

export const make = Effect.gen(function* () {
  const lineRuntimes = yield* LineRuntimeStore;
  return ApprovalAutoResponder.of({
    decide: Effect.fn("MercurianApprovalAutoResponder.decide")(function* ({ threadId, request }) {
      if (Option.isNone(yield* lineRuntimes.getByThreadId(threadId))) return Option.none();
      if (request.payload.requestType === "file_read_approval") {
        return Option.some("acceptForSession" as const);
      }
      const args = request.payload.args;
      const toolName =
        typeof args === "object" &&
        args !== null &&
        "toolName" in args &&
        typeof args.toolName === "string"
          ? normalizePlanningToolName(args.toolName)
          : undefined;
      return request.payload.requestType === "dynamic_tool_call" &&
        toolName !== undefined &&
        PLANNING_TOOLS.has(toolName)
        ? Option.some("acceptForSession" as const)
        : Option.none();
    }),
  });
});

export const MercurianApprovalAutoResponderLive = Layer.effect(ApprovalAutoResponder, make);
