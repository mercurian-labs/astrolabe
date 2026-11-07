import { HeaderHeightContext } from "@react-navigation/elements";
import { Children, useContext, type ReactNode } from "react";
import { View } from "react-native";

/** What a document says above its page. The header floats over the screen, so this clears it. */
export function WikiBelowHeader({ children }: { readonly children: ReactNode }) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  if (Children.toArray(children).length === 0) return null;
  return <View style={{ paddingTop: headerHeight }}>{children}</View>;
}
