import { reviewCanvasFiles } from "@mercurian/wiki/canvas";
import { documentTitle } from "@t3tools/client-runtime/wikiLogic";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import type { StaticScreenProps } from "@react-navigation/native";
import { useMemo } from "react";
import { View } from "react-native";

import { LoadingScreen } from "../../components/LoadingScreen";
import { EmptyState } from "../../components/ui/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { wikiEnvironment } from "../../state/wiki";
import { WikiCanvasScreen } from "./WikiCanvasScreen";
import type { WikiCanvasReviewParams } from "./wikiRoutes";

/** One canvas of a change request, as the board with marks on what it changed. */
export function WikiCanvasReviewRouteScreen({ route }: StaticScreenProps<WikiCanvasReviewParams>) {
  const { name } = route.params;
  const environmentId = route.params.environmentId as EnvironmentId;
  const wikiId = route.params.wikiId as WikiId;
  const changeRequestId = route.params.changeRequestId as WikiChangeRequestId;
  const detail = useEnvironmentQuery(
    wikiEnvironment.changeRequest({ environmentId, input: { wikiId, changeRequestId } }),
  );
  const change = detail.data?.files.find((file) => file.file === name);
  const before = change?.before ?? null;
  const after = change?.after ?? null;
  const found = change !== undefined;
  const review = useMemo(
    () => (found ? reviewCanvasFiles(before, after) : null),
    [found, before, after],
  );
  const title = documentTitle(name);
  if (detail.data === null || review === null || "invalid" in review) {
    return (
      <View className="flex-1 bg-screen">
        <NativeStackScreenOptions options={{ title }} />
        {detail.data === null && detail.error === null ? (
          <LoadingScreen message="Opening the change…" />
        ) : (
          <EmptyState
            title={`Couldn't show the changes to ${title}`}
            detail={
              detail.error ??
              (review !== null && "invalid" in review
                ? `${review.invalid} Open it on a computer to see the JSON.`
                : "This change request no longer changes it.")
            }
          />
        )}
      </View>
    );
  }
  const { changeRequest } = detail.data;
  return (
    <WikiCanvasScreen
      params={{
        environmentId,
        wikiId,
        name,
        // A merged or closed change request's documents are read from main.
        ...(changeRequest.status === "open" ? { changeRequestId } : {}),
      }}
      review={{ board: review, commit: changeRequest.head }}
    />
  );
}
