function dataFromNotificationResponse(response: unknown): Record<string, unknown> | null {
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const notification = (response as { readonly notification?: unknown }).notification;
  if (typeof notification !== "object" || notification === null) {
    return null;
  }
  const request = (notification as { readonly request?: unknown }).request;
  if (typeof request !== "object" || request === null) {
    return null;
  }
  const content = (request as { readonly content?: unknown }).content;
  if (typeof content !== "object" || content === null) {
    return null;
  }
  const data = (content as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

function identifierFromNotificationResponse(response: unknown): string | null {
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const notification = (response as { readonly notification?: unknown }).notification;
  if (typeof notification !== "object" || notification === null) {
    return null;
  }
  const request = (notification as { readonly request?: unknown }).request;
  if (typeof request !== "object" || request === null) {
    return null;
  }
  const identifier = (request as { readonly identifier?: unknown }).identifier;
  return typeof identifier === "string" ? identifier : null;
}

function encodeAgentDeepLink(input: {
  readonly route: "threads" | "plans" | "sessions";
  readonly environmentId: string;
  readonly resourceId: string;
}): string | null {
  if (input.environmentId.length === 0 || input.resourceId.length === 0) {
    return null;
  }
  return `/${input.route}/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.resourceId)}`;
}

function encodeThreadDeepLink(input: {
  readonly environmentId: string;
  readonly threadId: string;
}): string | null {
  return encodeAgentDeepLink({
    route: "threads",
    environmentId: input.environmentId,
    resourceId: input.threadId,
  });
}

function normalizeAgentDeepLink(value: string): string | null {
  if (
    value.trim() !== value ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return null;
  }

  const parts = value.split("/");
  const route = parts[1];
  if (
    parts.length !== 4 ||
    parts[0] !== "" ||
    (route !== "threads" && route !== "plans" && route !== "sessions")
  ) {
    return null;
  }

  try {
    return encodeAgentDeepLink({
      route,
      environmentId: decodeURIComponent(parts[2] ?? ""),
      resourceId: decodeURIComponent(parts[3] ?? ""),
    });
  } catch {
    return null;
  }
}

export function extractAgentNotificationDeepLink(response: unknown): string | null {
  const data = dataFromNotificationResponse(response);
  const deepLink = data?.deepLink;
  if (typeof deepLink === "string") {
    const normalizedDeepLink = normalizeAgentDeepLink(deepLink);
    if (normalizedDeepLink) {
      return normalizedDeepLink;
    }
  }

  const environmentId = data?.environmentId;
  const threadId = data?.threadId;
  if (typeof environmentId === "string" && typeof threadId === "string") {
    return encodeThreadDeepLink({ environmentId, threadId });
  }
  return null;
}

export function routeAgentNotificationResponseOnce(input: {
  readonly handledResponseIds: Set<string>;
  readonly response: unknown;
  readonly navigate: (deepLink: string) => void;
}): void {
  const responseId = identifierFromNotificationResponse(input.response);
  if (responseId && input.handledResponseIds.has(responseId)) {
    return;
  }
  if (responseId) {
    input.handledResponseIds.add(responseId);
  }
  const deepLink = extractAgentNotificationDeepLink(input.response);
  if (deepLink) {
    input.navigate(deepLink);
  }
}
