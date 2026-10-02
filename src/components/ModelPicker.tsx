import { useMemo } from "react";
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
import { useT } from "../lib/i18n.ts";
import { AgentMark } from "./AgentMark.tsx";

const TRIGGER = "min-w-0 gap-1 px-1.5 text-ui text-muted-foreground";
const MENU_ROW = "cursor-pointer text-ui";
const MENU_HEADING = "text-ui font-normal text-muted-foreground";
const FAMILIES = ["fable", "opus", "sonnet", "haiku"] as const;

export interface ModelPickerProps {
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

export function ModelPicker({ agent, agentLabel, model, effort, disabled, onCommand }: ModelPickerProps) {
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
