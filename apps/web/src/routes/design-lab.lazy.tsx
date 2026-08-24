import { createLazyFileRoute, useCanGoBack } from "@tanstack/react-router";
import { lazy, useCallback, useEffect } from "react";

const DesignLabLayout = import.meta.env.DEV
  ? lazy(() =>
      import("../components/design-system/DesignLabLayout").then(({ DesignLabLayout }) => ({
        default: DesignLabLayout,
      })),
    )
  : null;

export const Route = createLazyFileRoute("/design-lab")({
  component: DesignLabRoute,
});

function DesignLabRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const canGoBack = useCanGoBack();
  const navigateBackWithinApp = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
      navigateBackWithinApp();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateBackWithinApp]);

  if (DesignLabLayout === null) return null;

  return (
    <DesignLabLayout onSearchChange={(next) => void navigate({ search: next })} search={search} />
  );
}
