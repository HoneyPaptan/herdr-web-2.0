import { useShallow } from "zustand/react/shallow";

import type { Machine } from "../../../shared/machines.ts";
import { MachineActionBanner, MachineSidebar } from "../../components/MachineSidebar.tsx";
import { SidebarResizer } from "../../components/SidebarResizer.tsx";
import type { AppActions } from "../../lib/actions.ts";
import { useT } from "../../lib/i18n.ts";
import { useAppStore } from "../../store/appStore.ts";
import { selectTarget } from "../../store/selection.ts";
import { openMachineDialog, openNewSession, setDrawerOpen } from "../../store/ui.ts";
import { loadMachines } from "../feed/sync.ts";

function setupFromBanner(machine: Machine, update = false): void {
  setDrawerOpen(false);
  openMachineDialog(machine, update);
}

function setupFromSidebar(machine: Machine, update = false): void {
  openMachineDialog(machine, update);
}

function addMachine(): void {
  openMachineDialog("new");
}

export function MachineBanner() {
  const machines = useAppStore((state) => state.machines);
  return <MachineActionBanner machines={machines} onSetup={setupFromBanner} />;
}

function LoadError() {
  const t = useT();
  const error = useAppStore((state) => state.error);
  if (!error) return null;
  return <div className="error-state" role="alert"><p>{error}</p><button className="btn" onClick={() => void loadMachines()}>{t("Retry")}</button></div>;
}

export function SidebarHost({ actions }: { actions: AppActions }) {
  const { drawerOpen, machines, version, machineId, paneId } = useAppStore(useShallow((state) => ({
    drawerOpen: state.drawerOpen,
    machines: state.machines,
    version: state.health?.herdr?.version ?? null,
    machineId: state.selectedMachineId,
    paneId: state.selectedPaneId,
  })));
  return (
    <>
      <aside id="workspace-drawer" className={`sidebar${drawerOpen ? " is-open" : ""}`}>
        <LoadError />
        <MachineSidebar version={version} machines={machines} selectedMachineId={machineId} selectedPaneId={paneId} actions={actions} onSelect={selectTarget} onAdd={addMachine} onSetup={setupFromSidebar} onNew={openNewSession} />
        <SidebarResizer />
      </aside>
      {drawerOpen && <div className="scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}
    </>
  );
}
