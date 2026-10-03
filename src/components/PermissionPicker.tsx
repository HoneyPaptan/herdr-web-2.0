import { useEffect, useState } from "react";
import { ChevronDown, Shield, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { hasPermissionModes, type PermissionMode, type PermissionModes } from "../../shared/permission-mode.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { MENU_HEADING, MENU_NOTE, MENU_ROW, TRIGGER } from "./ModelPicker.tsx";

const MODE_LABEL: Record<PermissionMode, string> = {
  manual: "Manual",
  acceptEdits: "Accept edits",
  plan: "Plan",
  auto: "Auto",
  yolo: "Yolo",
  dontAsk: "Don't ask",
};

export interface PermissionPickerProps {
  paneId: string;
  agent: string | null;
  disabled: boolean;
}

function switchProblem(t: ReturnType<typeof useT>, error: unknown, agent: string, mode: PermissionMode): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === "prompt_open") return t("Answer the open prompt first.");
  if (code === "not_reachable" && mode === "yolo" && agent === "claude") return t("Yolo is off for this session. Start Claude with --allow-dangerously-skip-permissions to allow it.");
  if (code === "not_reachable") return t("This session does not offer that mode.");
  if (code === "not_shown") return t("Could not read the current mode.");
  return t("Could not switch the mode. Try again.");
}

function ModeIcon({ mode }: { mode: PermissionMode | null }) {
  const Icon = mode === "yolo" ? ShieldAlert : Shield;
  return <Icon className={cn("size-3.5 shrink-0", mode === "yolo" && "text-destructive")} aria-hidden="true" />;
}

function PermissionMenu({ paneId, agent, disabled }: PermissionPickerProps & { agent: string }) {
  const t = useT();
  const { fetchPermissionModes, switchPermissionMode } = useMachineApi();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PermissionModes | null>(null);
  const [switching, setSwitching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = state?.current ?? null;

  useEffect(() => {
    let live = true;
    fetchPermissionModes(paneId).then((next) => { if (live) setState(next); }, () => {});
    return () => { live = false; };
  }, [fetchPermissionModes, paneId]);

  const changeOpen = (next: boolean): void => {
    if (switching) return;
    setOpen(next);
    if (!next) return;
    setProblem(null);
    fetchPermissionModes(paneId).then(setState, () => setProblem(t("Could not read the current mode.")));
  };
  const pick = (value: string): void => {
    const mode = state?.modes.find((candidate) => candidate === value);
    if (!mode || mode === current) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setProblem(null);
    switchPermissionMode(paneId, mode)
      .then(() => {
        setState((previous) => previous && { ...previous, current: mode });
        setOpen(false);
      }, (error: unknown) => setProblem(switchProblem(t, error, agent, mode)))
      .finally(() => setSwitching(false));
  };

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={TRIGGER} disabled={disabled} aria-label={t("Switch permission mode")}>
          <ModeIcon mode={current} />
          <span className={cn("max-w-[7rem] min-w-0 truncate", current === "yolo" && "text-destructive")}>{t(current ? MODE_LABEL[current] : "Permissions")}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={4} className="w-[min(260px,calc(100vw-1rem))]">
        <DropdownMenuLabel className={MENU_HEADING}>{t("Permissions")}</DropdownMenuLabel>
        {state === null && problem === null && <p role="status" className={MENU_NOTE}>{t("Loading…")}</p>}
        {state !== null && (
          <DropdownMenuRadioGroup value={current ?? ""} onValueChange={pick}>
            {state.modes.map((mode) => (
              <DropdownMenuRadioItem key={mode} value={mode} disabled={switching} className={MENU_ROW} onSelect={(event) => event.preventDefault()}>
                <span className={cn("min-w-0 truncate", mode === "yolo" && "text-destructive")}>{t(MODE_LABEL[mode])}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        {switching && <p role="status" className={MENU_NOTE}>{t("Switching…")}</p>}
        {problem !== null && <p role="alert" className={cn(MENU_NOTE, "text-destructive")}>{problem}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PermissionPicker({ paneId, agent, disabled }: PermissionPickerProps) {
  if (!hasPermissionModes(agent)) return null;
  return <PermissionMenu key={paneId} paneId={paneId} agent={agent} disabled={disabled} />;
}
