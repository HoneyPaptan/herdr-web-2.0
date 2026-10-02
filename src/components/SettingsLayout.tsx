import { useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const NARROW = "(max-width: 767px)";

function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
}

export interface SettingsTab<T extends string> {
  id: T;
  label: string;
}

const NEXT_KEYS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export function SettingsTabs<T extends string>({ title, tabs, value, onChange, children }: {
  title: ReactNode;
  tabs: readonly SettingsTab<T>[];
  value: T;
  onChange: (id: T) => void;
  children: ReactNode;
}) {
  const narrow = useNarrow();
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = NEXT_KEYS[event.key];
    const index = tabs.findIndex((tab) => tab.id === value);
    const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : step === undefined ? -1 : (index + step + tabs.length) % tabs.length;
    if (target < 0) return;
    event.preventDefault();
    onChange(tabs[target]!.id);
    listRef.current?.querySelectorAll<HTMLElement>("[role=tab]")[target]?.focus();
  };
  return (
    <div className={narrow ? "flex h-full min-h-0 w-full min-w-0 flex-col gap-3" : "flex min-w-0 gap-5"}>
      <div className={cn("flex shrink-0 flex-col gap-3", narrow ? "min-w-0" : "w-32")}>
        {title}
        <div
          ref={listRef}
          role="tablist"
          aria-orientation={narrow ? "horizontal" : "vertical"}
          className={cn("flex gap-0.5", narrow ? "-mx-1 overflow-x-auto px-1 [&>*]:shrink-0" : "flex-col")}
          onKeyDown={moveFocus}
        >
          {tabs.map((tab) => {
            const selected = tab.id === value;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-slot="settings-tab"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                className={cn(
                  "cursor-pointer rounded-md px-2 py-1 text-left text-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onChange(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          key={value}
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${value}`}
          data-tab={value}
          className={cn(
            "settings-panel -mx-1 flex flex-col gap-7 overflow-y-auto px-1 [&::-webkit-scrollbar-track]:my-4 [&>*]:shrink-0",
            narrow ? "min-h-0 flex-1" : "h-[32rem] max-h-[60vh]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function SettingsSection({ title, className, children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn("settings-section flex min-w-0 flex-col gap-4", className)}>
      {title && <h2 className="text-ui font-medium text-muted-foreground">{title}</h2>}
      {children}
    </section>
  );
}

export function SettingDescription({ children }: { children: ReactNode }) {
  return <p className="text-ui text-muted-foreground">{children}</p>;
}

export function InlineRow({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-ui font-medium">{label}</span>
        <div className="max-w-full min-w-0">{children}</div>
      </div>
      {description && <SettingDescription>{description}</SettingDescription>}
    </div>
  );
}

export function StackedRow({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-ui font-medium">{label}</span>
        {description && <SettingDescription>{description}</SettingDescription>}
      </div>
      {children}
    </div>
  );
}

export function SettingNote({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return <p className={cn("text-ui", alert ? "text-destructive" : "text-muted-foreground/60")} role={alert ? "alert" : undefined}>{children}</p>;
}

export const SETTINGS_INPUT = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80";

export const SETTINGS_SELECT = "h-7 w-fit max-w-full min-w-0 cursor-pointer rounded-lg border border-input bg-transparent px-2 text-ui transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover";
