import { MERCURIAN_THEME_ID } from "@t3tools/shared/themePalettes";
import { useId, type ReactNode } from "react";
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from "react-native-svg";
import { withUniwind } from "uniwind";

import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { BRAND_RUST } from "./AstrolabeMarks";

/*
 * Ported from apps/web's ComposerControlIcons. Each action shape is drawn in the icon color with
 * a transparent ring cut around a shared pivot, which is brand rust in the Mercurian theme and the
 * icon color elsewhere. Only the composer's primary button uses them; the same actions elsewhere
 * keep their system symbols.
 */

export type ComposerControl = "send" | "stop" | "queue" | "steer";

const ThemedG = withUniwind(G);
const ThemedCircle = withUniwind(Circle);

function ControlIcon(props: {
  readonly size: number;
  readonly colorClassName: string;
  readonly children: ReactNode;
}) {
  const { themeId } = useAppearancePreferences();
  // Each SVG needs its own clip id; React's ids carry characters some renderers reject.
  const clipId = `pivot-ring-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 32 32" fill="none">
      <Defs>
        {/* The canvas less the pivot's 4.8-unit clearance: the transparent ring. */}
        <ClipPath id={clipId}>
          <Path
            clipRule="evenodd"
            d="M0 0H32V32H0Z M16 11.2A4.8 4.8 0 1 0 16 20.8A4.8 4.8 0 1 0 16 11.2Z"
          />
        </ClipPath>
      </Defs>
      <ThemedG
        colorClassName={props.colorClassName}
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        clipPath={`url(#${clipId})`}
      >
        {props.children}
      </ThemedG>
      {themeId === MERCURIAN_THEME_ID ? (
        <Circle cx={16} cy={16} r={3.25} fill={BRAND_RUST} />
      ) : (
        <ThemedCircle
          cx={16}
          cy={16}
          r={3.25}
          fill="currentColor"
          colorClassName={props.colorClassName}
        />
      )}
    </Svg>
  );
}

export function ComposerControlIcon(props: {
  readonly control: ComposerControl;
  readonly size: number;
  readonly colorClassName: string;
}) {
  const { control, ...iconProps } = props;
  return (
    <ControlIcon {...iconProps}>
      {control === "send" ? (
        <Path d="M19 10H24Q26 10 26 12V14Q26 16 24 16H6M12 10L6 16L12 22" />
      ) : control === "stop" ? (
        <Rect x={9} y={9} width={14} height={14} rx={0.5} fill="currentColor" stroke="none" />
      ) : control === "queue" ? (
        <Path d="M16 9.5H25M16 16H25M9.5 9.5V19.5Q9.5 22.5 12.5 22.5H25L21.5 26" />
      ) : (
        // Steer adapts Lucide's ship-wheel (ISC, Lucide Icons and Contributors).
        <G strokeWidth={2.5}>
          <Circle cx={16} cy={16} r={8.5} />
          <Path d="M16 3V29M3 16H29M6.8 6.8L25.2 25.2M6.8 25.2L25.2 6.8" />
        </G>
      )}
    </ControlIcon>
  );
}
