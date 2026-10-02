import { useMemo } from "react";

import type { AppActions } from "../../lib/actions.ts";
import { useSettings } from "../../lib/settings.ts";
import { useAppStore } from "../../store/appStore.ts";
import { selectCanSignOut } from "../../store/selectors.ts";
import { selectAdjacentPane, selectPane, setView, toggleView } from "../../store/selection.ts";
import { openFiles, openNewSession, openPalette, openSettings, toggleSidebar } from "../../store/ui.ts";
import { loadMachines, signOutDevice } from "../feed/sync.ts";

export function useAppActions(enableNotifications: (() => Promise<unknown>) | null): AppActions {
  const { resolvedTheme, update: updateSettings } = useSettings();
  const canSignOut = useAppStore(selectCanSignOut);
  const hasPane = useAppStore((state) => state.selectedPaneId !== null);
  return useMemo<AppActions>(
    () => ({
      selectPane,
      selectAdjacentPane,
      setView,
      toggleView,
      openNewSession: () => openNewSession(),
      openPalette,
      openSettings,
      toggleSidebar,
      toggleTheme: () => updateSettings({ theme: resolvedTheme === "dark" ? "light" : "dark" }),
      lock: canSignOut ? () => void signOutDevice() : null,
      enableNotifications: enableNotifications ? () => void enableNotifications() : null,
      refresh: () => void loadMachines(),
      openFiles: hasPane ? openFiles : null,
    }),
    [updateSettings, resolvedTheme, canSignOut, enableNotifications, hasPane],
  );
}
