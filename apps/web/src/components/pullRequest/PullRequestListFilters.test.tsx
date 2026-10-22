import { CircleIcon } from "lucide-react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { PullRequestFiltersMenu } from "./PullRequestListFilters";

function findValueChange(
  node: ReactNode,
):
  | ReactElement<{ readonly children?: ReactNode; readonly onValueChange: (value: string) => void }>
  | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as {
      readonly children?: ReactNode;
      readonly onValueChange?: (value: string) => void;
    };
    if (props.onValueChange) {
      return child as ReactElement<{
        readonly children?: ReactNode;
        readonly onValueChange: (value: string) => void;
      }>;
    }
    const nested = findValueChange(props.children);
    if (nested) return nested;
  }
  return undefined;
}

function findLabeledGroup(node: ReactNode, label: string): ReactNode {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as { readonly children?: ReactNode; readonly label?: string };
    if (props.label === label && typeof child.type === "function") {
      const rendered = (child.type as (properties: unknown) => ReactNode)(child.props);
      return findLabeledGroup(rendered, label) ?? rendered;
    }
    const nested = findLabeledGroup(props.children, label);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function menu(overrides: Partial<Parameters<typeof PullRequestFiltersMenu>[0]>) {
  return PullRequestFiltersMenu({
    state: "open",
    stateOptions: [
      { value: "open", label: "Open", Icon: CircleIcon },
      { value: "closed", label: "Closed", Icon: CircleIcon },
    ],
    onState: () => undefined,
    involvement: "all",
    involvementOptions: [{ value: "all", label: "All", Icon: CircleIcon }],
    onInvolvement: () => undefined,
    filters: {},
    onFilters: () => undefined,
    host: undefined,
    hostOptions: [],
    onHost: () => undefined,
    server: undefined,
    serverOptions: [],
    onServer: () => undefined,
    projects: [],
    projectId: undefined,
    projectEnvironmentId: undefined,
    unavailable: new Map(),
    onProject: () => undefined,
    ...overrides,
  });
}

describe("pull request filters menu", () => {
  it("offers a lone host only when it cannot be read, so its reason is in reach", () => {
    const all = { value: "", label: "All", Icon: CircleIcon };
    const gitHub = { value: "github.com", label: "GitHub", Icon: CircleIcon };
    expect(findLabeledGroup(menu({ hostOptions: [all, gitHub] }), "Host")).toBeUndefined();

    const onHost = vi.fn();
    const unreadable = { ...gitHub, unavailable: "Sign in with `gh auth login`." };
    const group = findValueChange(
      findLabeledGroup(
        menu({ hostOptions: [all, unreadable], host: "github.com", onHost }),
        "Host",
      ),
    );
    expect(group).toBeDefined();
    group?.props.onValueChange("");
    expect(onHost).toHaveBeenCalledWith(undefined);
  });
});
