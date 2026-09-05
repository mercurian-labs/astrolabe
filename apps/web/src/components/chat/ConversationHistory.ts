import type { ChatMessage } from "../../types";

/** A bounded, read-only page rendered with the regular conversation rows. */
export type ConversationHistoryPage = {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly nextCursor: string | null;
  readonly missing: boolean;
};

export type ConversationHistory = {
  readonly head: string;
  readonly historical: boolean;
  readonly readPage: (cursor: string) => ConversationHistoryPage;
};
