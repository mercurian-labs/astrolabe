import { useId, type ReactNode } from "react";

import { cn } from "~/lib/utils";

/*
 * The composer's four signature controls, from the branding repository's approved masters
 * (identity/astrolabe/controls). Each action shape is drawn in the current color with a
 * transparent ring cut around a shared pivot, and the pivot takes --pivot: brand rust in the
 * Mercurian theme, the current color elsewhere. They appear only in the composer's primary
 * button; the same actions elsewhere (a queued message's Steer) keep T3 Code's Lucide icons.
 */

function ControlIcon({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  // Each inline SVG needs its own clip id, or every control on the page shares the first one.
  // React's ids can carry characters url() references reject.
  const clipId = `pivot-ring-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-5 shrink-0", className)}
    >
      <defs>
        {/* The canvas less the pivot's 4.8-unit clearance: the transparent ring. */}
        <clipPath id={clipId}>
          <path
            clipRule="evenodd"
            d="M0 0H32V32H0Z M16 11.2A4.8 4.8 0 1 0 16 20.8A4.8 4.8 0 1 0 16 11.2Z"
          />
        </clipPath>
      </defs>
      <g
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        clipPath={`url(#${clipId})`}
      >
        {children}
      </g>
      <circle cx="16" cy="16" r="3.25" style={{ fill: "var(--pivot)" }} />
    </svg>
  );
}

export function SendControlIcon({ className }: { className?: string | undefined }) {
  return (
    <ControlIcon className={className}>
      <path d="M19 10H24Q26 10 26 12V14Q26 16 24 16H6M12 10L6 16L12 22" />
    </ControlIcon>
  );
}

export function StopControlIcon({ className }: { className?: string | undefined }) {
  return (
    <ControlIcon className={className}>
      <rect x="9" y="9" width="14" height="14" rx="0.5" fill="currentColor" stroke="none" />
    </ControlIcon>
  );
}

export function QueueControlIcon({ className }: { className?: string | undefined }) {
  return (
    <ControlIcon className={className}>
      <path d="M16 9.5H25M16 16H25M9.5 9.5V19.5Q9.5 22.5 12.5 22.5H25L21.5 26" />
    </ControlIcon>
  );
}

// Steer adapts Lucide's ship-wheel (ISC, Lucide Icons and Contributors), already a dependency.
export function SteerControlIcon({ className }: { className?: string | undefined }) {
  return (
    <ControlIcon className={className}>
      <g strokeWidth="2.5">
        <circle cx="16" cy="16" r="8.5" />
        <path d="M16 3V29M3 16H29M6.8 6.8L25.2 25.2M6.8 25.2L25.2 6.8" />
      </g>
    </ControlIcon>
  );
}
