import { memo } from "react";
import type { ColorValue } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { withUniwind } from "uniwind";

import {
  MARK_SMALL_DOTS,
  MARK_SMALL_INK,
  WORDMARK_DOTS,
  WORDMARK_INK,
  WORDMARK_SMALL_DOTS,
  WORDMARK_SMALL_INK,
} from "./astrolabeMarkLayers";
import type { MarkLayer } from "./markLayer";

const ThemedPath = withUniwind(Path);

/** Brand rust: the pivot and full stop keep it in every theme, as the marks guideline requires. */
export const BRAND_RUST = "#a0492a";

const WORDMARK_ASPECT_RATIO = 373.52 / 59.74;
const MARK_SMALL_ASPECT_RATIO = 627 / 702;

interface MarkProps {
  readonly height: number;
  /** Lettering color; defaults to the theme's foreground. */
  readonly color?: ColorValue;
  readonly colorClassName?: string;
  /** The mark's accessible name; omitted, the mark is decorative. */
  readonly accessibilityLabel?: string;
}

function InkLayer(props: {
  readonly layer: MarkLayer;
  readonly color: ColorValue | undefined;
  readonly colorClassName: string | undefined;
}) {
  return props.layer.nodes.map((node, nodeIndex) => (
    <G key={nodeIndex} transform={node.transform ?? undefined}>
      {node.children.map((child, childIndex) =>
        "d" in child ? (
          <ThemedPath
            key={childIndex}
            d={child.d}
            fillRule={child.evenOdd ? "evenodd" : "nonzero"}
            fill="currentColor"
            color={props.color}
            colorClassName={props.colorClassName}
          />
        ) : null,
      )}
    </G>
  ));
}

function DotsLayer(props: { readonly layer: MarkLayer }) {
  return props.layer.nodes.map((node, nodeIndex) => (
    <G key={nodeIndex} transform={node.transform ?? undefined}>
      {node.children.map((child, childIndex) =>
        "circle" in child ? (
          <Circle
            key={childIndex}
            cx={child.circle[0]}
            cy={child.circle[1]}
            r={child.circle[2]}
            fill={BRAND_RUST}
          />
        ) : (
          <Path key={childIndex} d={child.d} fill={BRAND_RUST} />
        ),
      )}
    </G>
  ));
}

function DuotoneMark(
  props: MarkProps & {
    readonly ink: MarkLayer;
    readonly dots: MarkLayer;
    readonly aspectRatio: number;
  },
) {
  // Without an explicit color, the lettering follows the theme's foreground.
  const colorClassName =
    props.colorClassName ?? (props.color === undefined ? "accent-foreground" : undefined);
  return (
    <Svg
      accessible={props.accessibilityLabel !== undefined}
      accessibilityLabel={props.accessibilityLabel}
      height={props.height}
      width={props.height * props.aspectRatio}
      viewBox={props.ink.viewBox}
    >
      <InkLayer layer={props.ink} color={props.color} colorClassName={colorClassName} />
      <DotsLayer layer={props.dots} />
    </Svg>
  );
}

/**
 * The full "Astrolabe." wordmark, the product's horizontal lockup. Width follows the canvas.
 * `small` draws its A with the monogram's small drawing, for use below the wordmark's 18px
 * cap-height minimum (roughly 24px tall), so its pivot matches the small monogram's.
 */
export const AstrolabeWordmark = memo(function AstrolabeWordmark(
  props: MarkProps & { readonly small?: boolean },
) {
  const small = props.small ?? false;
  return (
    <DuotoneMark
      {...props}
      ink={small ? WORDMARK_SMALL_INK : WORDMARK_INK}
      dots={small ? WORDMARK_SMALL_DOTS : WORDMARK_DOTS}
      aspectRatio={WORDMARK_ASPECT_RATIO}
    />
  );
});

/**
 * The monogram's small drawing, made for 16 and 24px icons where the full symbol would lose its
 * pivot ring.
 */
export const AstrolabeMarkSmall = memo(function AstrolabeMarkSmall(props: MarkProps) {
  return (
    <DuotoneMark
      {...props}
      ink={MARK_SMALL_INK}
      dots={MARK_SMALL_DOTS}
      aspectRatio={MARK_SMALL_ASPECT_RATIO}
    />
  );
});
