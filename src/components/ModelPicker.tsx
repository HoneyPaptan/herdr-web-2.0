import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OpencodeModels } from "../../shared/opencode-model.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { setView } from "../store/selection.ts";
import { AgentMark } from "./AgentMark.tsx";

const TRIGGER = "min-w-0 gap-1 px-1.5 text-ui text-muted-foreground";
const MENU_ROW = "cursor-pointer text-ui";
const MENU_HEADING = "text-ui font-normal text-muted-foreground";
const MENU_NOTE = "m-0 px-1.5 py-1 text-ui text-muted-foreground";
const FAMILIES = ["fable", "opus", "sonnet", "haiku"] as const;
const NATIVE_PICKERS: Record<string, string> = { codex: "/model", gemini: "/model", omp: "/model", pi: "/model" };

export interface ModelPickerProps {
  paneId: string;
  agent: string | null;
  agentLabel: string;
  model: string | null;
  effort: string | null;
  disabled: boolean;
  onCommand: (command: string) => void;
}

export function readableModel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(model);
  if (!match) return model;
  const [, family, major, minor] = match;
  return `${family![0]!.toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

export function modelFamily(model: string | null): string {
  return FAMILIES.find((family) => model?.includes(family)) ?? "";
}

function TriggerFace({ agent, name, effort }: { agent: string | null; name: string; effort: string | null }) {
  return (
    <>
      {agent && <AgentMark agent={agent} size={14} className="size-3.5 shrink-0" />}
      <span className="composer-model max-w-[11rem] min-w-0 truncate">{name}</span>
      {effort && <span className="composer-reasoning shrink-0 text-muted-foreground/60">{effort}</span>}
    </>
  );
}

function switchProblem(t: ReturnType<typeof useT>, error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === "not_reachable" || code === "not_listed") return t("This session has not used that model yet. Pick it once in the terminal.");
  if (code === "dialog_stuck") return t("A picker is open in the terminal. Close it and try again.");
  return t("Could not switch the model. Try again.");
}

interface OpencodeModelMenuProps {
  paneId: string;
  name: string;
  model: string | null;
  effort: string | null;
  disabled: boolean;
}

function OpencodeModelMenu({ paneId, name, model, effort, disabled }: OpencodeModelMenuProps) {
  const t = useT();
  const { fetchOpencodeModels, switchOpencodeModel } = useMachineApi();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<OpencodeModels | null>(null);
  const [switching, setSwitching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; over: string | null } | null>(null);
  const pickedShown = picked !== null && picked.over === model;

  const changeOpen = (next: boolean): void => {
    if (switching) return;
    setOpen(next);
    if (!next) return;
    setList(null);
    setProblem(null);
    fetchOpencodeModels(paneId).then(setList, () => setProblem(t("Could not load the models.")));
  };
  const pick = (id: string): void => {
    const choice = list?.models.find((candidate) => candidate.id === id);
    if (!choice || id === list?.current) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setProblem(null);
    switchOpencodeModel(paneId, id)
      .then(() => {
        setPicked({ name: choice.name, over: model });
        setOpen(false);
      }, (error: unknown) => setProblem(switchProblem(t, error)))
      .finally(() => setSwitching(false));
  };

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={TRIGGER} disabled={disabled} aria-label={t("Switch model")}>
          <TriggerFace agent="opencode" name={pickedShown ? picked.name : name} effort={pickedShown ? null : effort} />
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={4} className="w-[min(320px,calc(100vw-1rem))]">
        <DropdownMenuLabel className={MENU_HEADING}>{t("Recent models")}</DropdownMenuLabel>
        {list === null && problem === null && <p role="status" className={MENU_NOTE}>{t("Loading…")}</p>}
        {list?.models.length === 0 && <p role="status" className={MENU_NOTE}>{t("No recent models yet. Pick one in the terminal first.")}</p>}
        {list !== null && list.models.length > 0 && (
          <DropdownMenuRadioGroup value={list.current ?? ""} onValueChange={pick}>
            {list.models.map((choice) => (
              <DropdownMenuRadioItem key={choice.id} value={choice.id} disabled={switching} className={MENU_ROW} onSelect={(event) => event.preventDefault()}>
                <span className="min-w-0 truncate">{choice.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground/60">{choice.provider}</span>
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

export function ModelPicker({ paneId, agent, agentLabel, model, effort, disabled, onCommand }: ModelPickerProps) {
  const t = useT();
  const name = model ? readableModel(model) : agentLabel;
  const models = useMemo(() => [
    { id: "default", label: t("Default") },
    { id: "fable", label: "Fable" },
    { id: "opus", label: "Opus" },
    { id: "sonnet", label: "Sonnet" },
    { id: "haiku", label: "Haiku" },
    { id: "opus[1m]", label: t("Opus, 1M context") },
    { id: "opusplan", label: t("Opus to plan, Sonnet to build") },
  ], [t]);
  const efforts = useMemo(() => [
    { id: "auto", label: t("Auto") },
    { id: "low", label: t("Low") },
    { id: "medium", label: t("Medium") },
    { id: "high", label: t("High") },
    { id: "xhigh", label: t("Extra high") },
    { id: "max", label: t("Max") },
  ], [t]);

  if (agent === "opencode") return <OpencodeModelMenu key={paneId} paneId={paneId} name={name} model={model} effort={effort} disabled={disabled} />;

  const nativePicker = agent ? NATIVE_PICKERS[agent] : undefined;
  if (nativePicker) {
    const open = (): void => {
      onCommand(nativePicker);
      setView("terminal");
    };
    return (
      <Button variant="ghost" size="sm" className={TRIGGER} disabled={disabled} aria-label={t("Switch model")} onClick={open}>
        <TriggerFace agent={agent} name={name} effort={effort} />
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </Button>
    );
  }

  if (agent !== "claude") {
    return <span className={`inline-flex h-7 items-center ${TRIGGER}`}><TriggerFace agent={agent} name={name} effort={effort} /></span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={TRIGGER} disabled={disabled} aria-label={t("Switch model")}>
          <TriggerFace agent={agent} name={name} effort={effort} />
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={4} className="w-[min(280px,calc(100vw-1rem))]">
        <DropdownMenuLabel className={MENU_HEADING}>{t("Model")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={modelFamily(model)} onValueChange={(id) => onCommand(`/model ${id}`)}>
          {models.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className={MENU_ROW}>
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={MENU_HEADING}>{t("Effort")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={effort ?? ""} onValueChange={(id) => onCommand(`/effort ${id}`)}>
          {efforts.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className={MENU_ROW}>
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
