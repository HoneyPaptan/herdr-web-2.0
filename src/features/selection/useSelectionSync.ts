import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import type { SessionSnapshot } from "../../../shared/protocol.ts";
import { displayPaneTitle } from "../../components/Sidebar.tsx";
import { fetchSession } from "../../lib/api.ts";
import { onNotificationTarget } from "../../lib/notificationTarget.ts";
import { useSettings } from "../../lib/settings.ts";
import { setApp, useAppStore } from "../../store/appStore.ts";
import { paneFromUrl, storedView, storeSelection } from "../../store/persistence.ts";
import { selectSelectedMachine, selectSelectedPane, selectSnapshot, selectTerminalAttach } from "../../store/selectors.ts";
import { selectTarget } from "../../store/selection.ts";

const APP_TITLE = "herdr web ui";

function fallbackPane(snapshot: SessionSnapshot): string | null {
  return snapshot.panes.find((pane) => pane.pane_id === snapshot.focused_pane_id)?.pane_id ?? snapshot.panes[0]?.pane_id ?? null;
}

function hasPane(snapshot: SessionSnapshot, paneId: string | null): boolean {
  return snapshot.panes.some((pane) => pane.pane_id === paneId);
}

function useReleaseClosedPane(): void {
  const { snapshot, machineId, paneId, machineState } = useAppStore(useShallow((state) => ({
    snapshot: selectSnapshot(state),
    machineId: state.selectedMachineId,
    paneId: state.selectedPaneId,
    machineState: selectSelectedMachine(state)?.state,
  })));
  useEffect(() => {
    if (!snapshot || machineState !== "connected" || hasPane(snapshot, paneId)) return;
    if (paneId === null) { setApp({ selectedPaneId: fallbackPane(snapshot) }); return; }
    let cancelled = false;
    void fetchSession(machineId).then((current) => {
      if (cancelled || hasPane(current, paneId)) return;
      setApp({ selectedPaneId: fallbackPane(current), autoSelected: true });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [snapshot, paneId, machineId, machineState]);
}

function usePersistSelection(): void {
  const machineId = useAppStore((state) => state.selectedMachineId);
  const paneId = useAppStore((state) => state.selectedPaneId);
  useEffect(() => storeSelection(machineId, paneId), [machineId, paneId]);
}

function useViewFollowsPane(): void {
  const { settings } = useSettings();
  const { machineId, paneId, paneKnown, hasAgent, terminalAttach } = useAppStore(useShallow((state) => {
    const pane = selectSelectedPane(state);
    return {
      machineId: state.selectedMachineId,
      paneId: state.selectedPaneId,
      paneKnown: pane !== null,
      hasAgent: (pane?.agent ?? null) !== null,
      terminalAttach: selectTerminalAttach(state),
    };
  }));
  useEffect(() => {
    if (paneId === null) return;
    setApp({ view: storedView(paneId, machineId, paneKnown ? hasAgent : null, terminalAttach, settings.defaultView) });
  }, [paneId, machineId, paneKnown, hasAgent, terminalAttach, settings.defaultView]);
}

function useNotificationTargets(): void {
  useEffect(() => onNotificationTarget((target) => selectTarget(target.machine_id, target.pane_id)), []);
  useEffect(() => {
    if (paneFromUrl() !== null) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
}

function useDocumentTitle(): void {
  const title = useAppStore((state) => {
    const pane = selectSelectedPane(state);
    return pane ? displayPaneTitle(pane) : null;
  });
  useEffect(() => {
    document.title = title ? `${title} · herdr` : APP_TITLE;
  }, [title]);
}

export function useSelectionSync(): void {
  useReleaseClosedPane();
  usePersistSelection();
  useViewFollowsPane();
  useNotificationTargets();
  useDocumentTitle();
}
