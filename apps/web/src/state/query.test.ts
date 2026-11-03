import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { queryAnswer } from "./query";

describe("queryAnswer", () => {
  const answered = AsyncResult.success(["worktree"]);
  const failed = Cause.fail(new Error("The folder is gone."));

  it("has neither an answer nor an error only while the first read runs", () => {
    expect(queryAnswer(AsyncResult.initial(true))).toEqual({ data: null, error: null });
  });

  it("reports a read that failed with nothing to show, so its reader stops loading", () => {
    expect(queryAnswer(AsyncResult.failure(failed))).toEqual({
      data: null,
      error: "The folder is gone.",
    });
  });

  it("keeps the last answer through a failed refresh", () => {
    expect(
      queryAnswer(AsyncResult.failureWithPrevious(failed, { previous: Option.some(answered) })),
    ).toEqual({ data: ["worktree"], error: null });
  });
});
