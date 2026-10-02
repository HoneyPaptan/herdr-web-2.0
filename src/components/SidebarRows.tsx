import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "../../shared/protocol.ts";
import { StatusRail } from "./StatusMark.tsx";

const RAIL_X = 12;
const STEP = 12;
const ELBOW = 10;
const RAIL = "pointer-events-none absolute w-px bg-sidebar-border";
const ACTIVE_ON_TOUCH = "pointer-coarse:group-aria-[current=true]:pointer-events-auto pointer-coarse:group-aria-[current=true]:opacity-100";

export const SIDEBAR_LIST = "flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-3 pl-2 pr-0";
export const SIDEBAR_EMPTY = "px-2 py-6 text-ui text-muted-foreground";
export const ROW_INPUT = "h-6 w-full min-w-0 rounded-md border border-input bg-transparent px-1.5 text-ui outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export function GroupSpacer({ run = false }: { run?: boolean }) {
  return <div aria-hidden="true" className={cn("shrink-0", run ? "h-3" : "h-4")} />;
}

export function HeadingLabel({ children }: { children: ReactNode }) {
  return <div className="flex min-h-6 items-center truncate pr-0.5 pl-2 text-ui text-muted-foreground/70">{children}</div>;
}

export function HeadingRow({ label, toggleLabel, expanded, onToggle, detail, actions, className, ...rest }: {
  label: ReactNode;
  toggleLabel?: string;
  expanded: boolean;
  onToggle: () => void;
  detail?: ReactNode;
  actions?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("group/heading flex min-h-6 items-center pr-0.5 pointer-coarse:min-h-9", className)} {...rest}>
      <button
        type="button"
        data-slot="sidebar-heading"
        aria-expanded={expanded}
        aria-label={toggleLabel}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch rounded-md pl-2 text-left text-ui text-muted-foreground/70 transition-colors duration-150 outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onClick={onToggle}
      >
        <span className="truncate">{label}</span>
        {detail}
        {!expanded && <ChevronRight aria-hidden="true" className="size-3 shrink-0" />}
      </button>
      {actions && <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/heading:opacity-100 group-hover/heading:opacity-100 pointer-coarse:opacity-100">{actions}</div>}
    </div>
  );
}

export function RowAction({ label, onClick, disabled, pressed, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  const run = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onClick();
  };
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={cn("cursor-pointer pointer-coarse:size-8", pressed ? "text-foreground" : "text-muted-foreground")}
      onClick={run}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </Button>
  );
}

function NestRails({ depth, continues, opensRail }: { depth: number; continues: boolean; opensRail: boolean }) {
  const ownRail = RAIL_X + (depth - 1) * STEP;
  return (
    <>
      {depth > 0 && (
        <>
          <span aria-hidden="true" className={cn(RAIL, "top-0")} style={{ left: ownRail, height: continues ? "calc(100% + 1px)" : "50%" }} />
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 h-px bg-sidebar-border" style={{ left: ownRail + 1, width: ELBOW - 5 }} />
          <span aria-hidden="true" className="shrink-0" style={{ width: ownRail + 2 }} />
        </>
      )}
      {opensRail && <span aria-hidden="true" className={cn(RAIL, "top-1/2 -bottom-px")} style={{ left: RAIL_X + depth * STEP }} />}
    </>
  );
}

export function SessionRow({ active, status, title, meta, actions, open = false, depth = 0, continues = false, opensRail = false, onSelect, onKeyDown, className, ...rest }: {
  active: boolean;
  status?: AgentStatus;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  open?: boolean;
  depth?: number;
  continues?: boolean;
  opensRail?: boolean;
  onSelect: () => void;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "onSelect">) {
  const selectByKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      data-state={open ? "open" : undefined}
      className={cn(
        "group relative flex min-h-7 w-full shrink-0 cursor-pointer items-center rounded-md pl-0 pr-0.5 transition-[color,background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:min-h-9",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 data-[state=open]:bg-sidebar-accent/50",
        className,
      )}
      onClick={onSelect}
      onKeyDown={selectByKey}
      {...rest}
    >
      <StatusRail status={status} />
      <NestRails depth={depth} continues={continues} opensRail={opensRail} />
      <span className="min-w-0 flex-1 truncate text-ui">{title}</span>
      <div data-row-meta className="relative flex min-w-[4em] shrink-0 items-center justify-end self-stretch pl-2 text-ui">
        <span className={cn("pointer-events-none absolute right-0 flex items-center gap-1 whitespace-nowrap text-ui text-muted-foreground transition-opacity duration-150 group-data-[state=open]:opacity-0", actions && "group-hover:opacity-0 pointer-coarse:group-aria-[current=true]:opacity-0")}>{meta}</span>
        {actions && <div className={cn("pointer-events-none relative flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-data-[state=open]:pointer-events-auto group-data-[state=open]:opacity-100", ACTIVE_ON_TOUCH)}>{actions}</div>}
      </div>
    </div>
  );
}
