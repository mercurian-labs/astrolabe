import { useCallback, useMemo } from "react";
import {
  Markdown,
  type CustomRenderers,
  type NodeStyleOverrides,
  type PartialMarkdownTheme,
} from "react-native-nitro-markdown";
import { Text as NativeText } from "react-native";

import {
  resolveMarkdownFontSizes,
  resolveNativeMarkdownTypography,
} from "../../lib/appearancePreferences";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useFontFamily } from "../../lib/useFontFamily";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  hasNativeSelectableMarkdownText,
  SelectableMarkdownText,
  type NativeMarkdownTextStyle,
} from "../../native/SelectableMarkdownText";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

interface PlanMarkdownStyles {
  readonly theme: PartialMarkdownTheme;
  readonly styles: NodeStyleOverrides;
  readonly renderers: CustomRenderers;
  readonly nativeTextStyle: NativeMarkdownTextStyle;
}

export function usePlanMarkdownStyles(): PlanMarkdownStyles {
  const { appearance } = useAppearancePreferences();
  const markdownFontSizes = useMemo(
    () => resolveMarkdownFontSizes(appearance.baseFontSize),
    [appearance.baseFontSize],
  );
  const nativeTypography = useMemo(
    () => resolveNativeMarkdownTypography(appearance.baseFontSize),
    [appearance.baseFontSize],
  );
  const body = String(useThemeColor("--color-md-body"));
  const strong = String(useThemeColor("--color-md-strong"));
  const link = String(useThemeColor("--color-md-link"));
  const quoteBorder = String(useThemeColor("--color-md-blockquote-border"));
  const quoteBackground = String(useThemeColor("--color-md-blockquote-bg"));
  const codeBackground = String(useThemeColor("--color-md-code-bg"));
  const codeText = String(useThemeColor("--color-md-code-text"));
  const rule = String(useThemeColor("--color-md-hr"));
  const regularFontFamily = useFontFamily("regular");
  const mediumFontFamily = useFontFamily("medium");
  const boldFontFamily = useFontFamily("bold");

  return useMemo(() => {
    const renderers: CustomRenderers = {
      link: ({ href, children }) => (
        <NativeText
          onPress={() => href && void tryOpenExternalUrl(href, "markdown-link")}
          style={{ color: link, fontFamily: mediumFontFamily, textDecorationLine: "none" }}
        >
          {children}
        </NativeText>
      ),
    };
    return {
      theme: {
        colors: {
          text: body,
          heading: strong,
          link,
          blockquote: quoteBorder,
          border: rule,
          surface: "transparent",
          surfaceLight: quoteBackground,
          accent: link,
          tableBorder: rule,
          tableHeader: quoteBackground,
          tableHeaderText: strong,
          tableRowOdd: quoteBackground,
          tableRowEven: "transparent",
          code: codeText,
          codeBackground,
        },
      },
      styles: {
        text: {
          color: body,
          fontFamily: regularFontFamily,
          fontSize: markdownFontSizes.m,
          lineHeight: markdownFontSizes.bodyLineHeight,
        },
        heading: { color: strong, fontFamily: boldFontFamily },
        strong: { color: strong, fontFamily: boldFontFamily },
        link: { color: link, fontFamily: mediumFontFamily },
        blockquote: {
          backgroundColor: quoteBackground,
          borderLeftColor: quoteBorder,
          borderLeftWidth: 3,
          paddingLeft: 12,
        },
        code: { backgroundColor: codeBackground, color: codeText, fontFamily: "ui-monospace" },
        codeBlock: {
          backgroundColor: codeBackground,
          borderRadius: 12,
          color: codeText,
          fontFamily: "ui-monospace",
          padding: 12,
        },
        hr: { backgroundColor: rule },
      },
      renderers,
      nativeTextStyle: {
        color: body,
        strongColor: strong,
        mutedColor: body,
        linkColor: link,
        inlineCodeColor: codeText,
        codeColor: codeText,
        codeBackgroundColor: codeBackground,
        codeBlockBackgroundColor: codeBackground,
        fileTextColor: codeText,
        skillTextColor: codeText,
        quoteMarkerColor: quoteBorder,
        dividerColor: rule,
        fontSize: nativeTypography.fontSize,
        lineHeight: nativeTypography.lineHeight,
        headingFontSizes: nativeTypography.headingFontSizes,
        fontFamily: regularFontFamily,
        headingFontFamily: boldFontFamily,
        boldFontFamily,
      },
    };
  }, [
    body,
    boldFontFamily,
    codeBackground,
    codeText,
    link,
    markdownFontSizes,
    mediumFontFamily,
    nativeTypography,
    quoteBackground,
    quoteBorder,
    regularFontFamily,
    rule,
    strong,
  ]);
}

export function PlanMarkdown(props: { readonly markdown: string }) {
  const styles = usePlanMarkdownStyles();
  const onLinkPress = useCallback((href: string) => {
    void tryOpenExternalUrl(href, "markdown-link");
  }, []);
  return hasNativeSelectableMarkdownText() ? (
    <SelectableMarkdownText
      markdown={props.markdown}
      onLinkPress={onLinkPress}
      textStyle={styles.nativeTextStyle}
    />
  ) : (
    <Markdown
      options={{ gfm: true }}
      renderers={styles.renderers}
      styles={styles.styles}
      theme={styles.theme}
    >
      {props.markdown}
    </Markdown>
  );
}
