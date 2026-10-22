import type { CSSProperties } from "react";

import markSmallDotsUrl from "~/assets/brand/mark-small-dots.svg?url";
import markSmallInkUrl from "~/assets/brand/mark-small-ink.svg?url";
import wordmarkDotsUrl from "~/assets/brand/wordmark-dots.svg?url";
import wordmarkInkUrl from "~/assets/brand/wordmark-ink.svg?url";
import wordmarkSmallDotsUrl from "~/assets/brand/wordmark-small-dots.svg?url";
import wordmarkSmallInkUrl from "~/assets/brand/wordmark-small-ink.svg?url";
import { cn } from "~/lib/utils";

/*
 * Astrolabe's marks, from the branding repository's approved masters (identity/astrolabe), drawn
 * duotone: each mark is two masks over one canvas, the lettering in the text color and the pivot
 * and full stop in brand rust, which no theme recolors.
 */

interface MarkProps {
  className?: string;
  /** Draws the lettering white, for a mark over dark artwork in either appearance. */
  onDark?: boolean;
  /** The mark's accessible name; omitted, the mark is decorative. */
  label?: string;
}

function maskStyle(url: string): CSSProperties {
  const image = `url("${url}")`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    // Every layer shares its mark's canvas, so contained and centered they stay in register
    // in any box without stretching.
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskPosition: "center",
    WebkitMaskPosition: "center",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
}

function DuotoneMark({
  inkUrl,
  dotsUrl,
  className,
  onDark,
  label,
}: MarkProps & { inkUrl: string; dotsUrl: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("relative inline-block", className)}
    >
      <span
        className={cn("absolute inset-0", onDark ? "bg-white" : "bg-foreground")}
        style={maskStyle(inkUrl)}
      />
      <span className="absolute inset-0 bg-(--brand-rust)" style={maskStyle(dotsUrl)} />
    </span>
  );
}

/**
 * The full "Astrolabe." wordmark, which is also the product's horizontal lockup. Set its height
 * with the className; the width follows the canvas. `small` draws its A with the monogram's small
 * drawing, which the brand uses for any wordmark 48px tall or less, so its pivot matches the small
 * monogram's.
 */
export function AstrolabeWordmark({
  className,
  small = false,
  ...props
}: MarkProps & { small?: boolean }) {
  return (
    <DuotoneMark
      inkUrl={small ? wordmarkSmallInkUrl : wordmarkInkUrl}
      dotsUrl={small ? wordmarkSmallDotsUrl : wordmarkDotsUrl}
      className={cn("aspect-[373.52/68.78]", className)}
      {...props}
    />
  );
}

/**
 * The monogram's small drawing, which the brand uses for any mark 48px tall or less: wider needle
 * tips and a larger pivot, so both survive at icon sizes. Size it with the className, as an icon.
 */
export function AstrolabeMarkSmall({ className, ...props }: MarkProps) {
  return (
    <DuotoneMark
      inkUrl={markSmallInkUrl}
      dotsUrl={markSmallDotsUrl}
      className={cn("aspect-[280.27/362]", className)}
      {...props}
    />
  );
}
