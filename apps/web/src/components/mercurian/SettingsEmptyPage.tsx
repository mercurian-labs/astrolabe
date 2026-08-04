import type { ComponentType, ReactNode } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

/**
 * A settings section that exists before its contents do — the same posture as
 * the Repositories page: the section is a destination now so the issue that
 * fills it does not have to move the shell first. The description names what
 * will live there, so an empty page still says something true.
 */
export function SettingsEmptyPage({
  icon: Icon,
  title,
  description,
}: {
  readonly icon: ComponentType<{ className?: string }>;
  readonly title: string;
  readonly description: ReactNode;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <EmptyTitle className="text-foreground text-xl">{title}</EmptyTitle>
        <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
          {description}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
