import { useShallow } from "zustand/react/shallow";

import { PaneTerminal } from "../../components/PaneTerminal.tsx";
import { useSettings } from "../../lib/settings.ts";
import { useAppStore } from "../../store/appStore.ts";
import { handleServerMessage, setConnection, setRole } from "../../store/connection.ts";
import { selectSelectedPane } from "../../store/selectors.ts";

export function TerminalHost() {
  const { settings, resolvedTheme } = useSettings();
  const target = useAppStore(useShallow((state) => {
    const pane = selectSelectedPane(state);
    return {
      machineId: state.selectedMachineId,
      paneId: state.selectedPaneId,
      restoreError: pane?.restore_error ?? null,
      agent: pane?.agent ?? null,
      agentStatus: pane?.agent_status,
      backgroundTasks: pane?.background_tasks ?? 0,
      view: state.view,
      autoSelected: state.autoSelected,
      role: state.role,
    };
  }));
  return (
    <main className="terminal-host">
      <PaneTerminal
        key={target.machineId}
        paneId={target.restoreError ? null : target.paneId}
        restoreError={target.restoreError}
        agent={target.agent}
        agentStatus={target.agentStatus}
        backgroundTasks={target.backgroundTasks}
        view={target.view}
        autoSelected={target.autoSelected}
        terminalFontSize={settings.terminalFontSize}
        terminalWheelSpeed={settings.terminalWheelSpeed}
        terminalFontFamily={settings.terminalFontFamily}
        theme={resolvedTheme}
        palette={settings.palette}
        role={target.role}
        onRoleAck={setRole}
        onConnectionChange={setConnection}
        onServerMessage={handleServerMessage}
      />
    </main>
  );
}
