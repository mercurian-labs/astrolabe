import { createElement, type ComponentProps } from "react";

// Vite resolves this story-only name to the package's concrete ESM entry. Keeping
// the secondary name out of TypeScript's package graph preserves the app's
// @tanstack/react-router module augmentation.
// @ts-expect-error Storybook's Vite alias supplies this runtime-only module.
export * from "storybook-tanstack-react-router-real";

export function Link({
  to,
  params,
  ...props
}: Omit<ComponentProps<"a">, "href"> & {
  readonly to: string;
  readonly params?: Readonly<Record<string, string>>;
}) {
  return createElement("a", {
    ...props,
    href: to.replace(/\$(\w+)/g, (_match, key: string) => params?.[key] ?? ""),
  });
}
