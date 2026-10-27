import type { ComponentProps } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

/** A list header with a count, drawn like the Agents sidebar's shelves in each design. */
export function CountedSectionHeader({
  label,
  count,
  ...props
}: Omit<ComponentProps<typeof CollapsibleSectionHeader>, "children" | "accessory"> & {
  label: string;
  count: number;
}) {
  const redesign = useClientSettings((s) => s.redesignEnabled);
  return (
    <CollapsibleSectionHeader
      {...props}
      accessory={redesign ? <span className="font-normal tabular-nums">{count}</span> : undefined}
    >
      {redesign ? label : `${label} · ${count}`}
    </CollapsibleSectionHeader>
  );
}
