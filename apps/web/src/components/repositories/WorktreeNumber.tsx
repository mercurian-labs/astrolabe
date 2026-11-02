/** Astrolabe: a worktree's number, as its sidebar header and its tabs show it. */
export function WorktreeNumber({ number }: { readonly number: number }) {
  return (
    <span
      aria-label={`Worktree ${number}`}
      className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-primary text-3xs leading-none font-semibold text-primary-foreground tabular-nums"
    >
      {number}
    </span>
  );
}
