import type { Machine } from "../../shared/machines.ts";
import { paneStorageId } from "../../shared/machines.ts";
import { useT } from "../lib/i18n.ts";
import { panesNeedingInput } from "../lib/needsInput.ts";
import { displayPaneTitle } from "./Sidebar.tsx";
import { GroupSpacer, HeadingLabel, SessionRow } from "./SidebarRows.tsx";

export function NeedsInput({ machines, selectedMachineId, selectedPaneId, onSelect }: {
  machines: Machine[];
  selectedMachineId: string;
  selectedPaneId: string | null;
  onSelect(machineId: string, paneId: string): void;
}) {
  const t = useT();
  const waiting = panesNeedingInput(machines);
  return <>
    <p className="visually-hidden" role="status">{t("Panes waiting for input: {n}", { n: waiting.length })}</p>
    {waiting.length > 0 && <>
      <section className="needs-input flex flex-col gap-px" aria-label={t("Needs you")}>
        <HeadingLabel>{t("Needs you")}</HeadingLabel>
        {waiting.map(({ machine, pane, workspace }) => {
          const selected = machine.id === selectedMachineId && pane.pane_id === selectedPaneId;
          return <SessionRow
            key={paneStorageId(machine.id, pane.pane_id)}
            className="pane-select needs-input-select"
            active={selected}
            status={pane.agent_status}
            aria-label={`${displayPaneTitle(pane)}, ${machine.name}, ${workspace.label}`}
            title={<>{displayPaneTitle(pane)} <span className="text-muted-foreground/60">{workspace.label}</span></>}
            onSelect={() => onSelect(machine.id, pane.pane_id)}
          />;
        })}
      </section>
      <GroupSpacer />
    </>}
  </>;
}
