import type { KeyboardEvent, Ref } from "react";

import { cn } from "@/lib/utils";
import { modeFor, THEMES, type Mode, type ThemeName } from "../lib/theme.ts";

export interface Choice<T extends string> {
  id: T;
  label: string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function radioKeys<T extends string>(ids: readonly T[], value: T, onChange: (id: T) => void) {
  return (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEP[event.key];
    if (step === undefined || ids.length === 0) return;
    event.preventDefault();
    const index = (Math.max(0, ids.indexOf(value)) + step + ids.length) % ids.length;
    onChange(ids[index]!);
    event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")[index]?.focus();
  };
}

export function ChoicePills<T extends string>({ value, options, label, disabled = false, firstRef, onChange }: {
  value: T;
  options: readonly Choice<T>[];
  label: string;
  disabled?: boolean;
  firstRef?: Ref<HTMLButtonElement>;
  onChange: (id: T) => void;
}) {
  const selected = options.some((option) => option.id === value) ? value : options[0]?.id;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn("inline-flex w-fit max-w-full shrink-0 flex-wrap gap-0.5 rounded-lg bg-muted p-0.5", disabled && "opacity-50")}
      onKeyDown={disabled ? undefined : radioKeys(options.map((option) => option.id), value, onChange)}
    >
      {options.map((option, index) => {
        const checked = option.id === selected;
        return (
          <button
            key={option.id}
            ref={index === 0 ? firstRef : undefined}
            type="button"
            role="radio"
            data-slot="choice-pill"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className={cn(
              "cursor-pointer rounded-[calc(var(--radius)-4px)] px-3 py-1 text-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
              checked ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeSwatches({ value, mode, label, onChange }: { value: ThemeName; mode: Mode; label: string; onChange: (id: ThemeName) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-start gap-3" onKeyDown={radioKeys(THEMES.map((theme) => theme.id), value, onChange)}>
      {THEMES.map((theme) => {
        const checked = theme.id === value;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            data-slot="theme-swatch"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="group flex w-14 cursor-pointer flex-col items-center gap-1.5 outline-none"
            onClick={() => onChange(theme.id)}
          >
            <span
              data-theme={theme.id}
              data-mode={modeFor(theme.id, mode)}
              className={cn(
                "theme-swatch size-12 rounded-md border transition-colors",
                checked ? "border-transparent ring-2 ring-ring ring-offset-2 ring-offset-popover" : "border-border group-hover:border-muted-foreground/60 group-focus-visible:border-ring",
              )}
            />
            <span className={cn("w-full truncate text-center text-ui", checked ? "text-foreground" : "text-muted-foreground")}>{theme.label}</span>
          </button>
        );
      })}
    </div>
  );
}
