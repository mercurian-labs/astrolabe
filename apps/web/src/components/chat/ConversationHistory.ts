import type { ChatMessage } from "../../types";

/** A bounded, read-only page rendered with the regular conversation rows. */
export type ConversationHistoryPage = {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly nextCursor: string | null;
  readonly missing: boolean;
};

export type ConversationHistory = {
  readonly origin: string;
  readonly label: string;
  readonly readPage: (cursor: string) => ConversationHistoryPage;
};
