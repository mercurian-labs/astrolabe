import type { ComponentProps } from "react";

import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

/** A list header with a count, drawn like the Agents sidebar's shelves. */
export function CountedSectionHeader({
  label,
  count,
  ...props
}: Omit<ComponentProps<typeof CollapsibleSectionHeader>, "children" | "accessory"> & {
  label: string;
  count: number;
}) {
  return (
    <CollapsibleSectionHeader
      {...props}
      accessory={<span className="font-normal tabular-nums">{count}</span>}
    >
      {label}
    </CollapsibleSectionHeader>
  );
}
