import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd data-slot="kbd" className={cn("pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3", className)} {...props} />;
}

export function KbdGroup({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}

export function ShortcutKeys({ keys, className }: { keys: readonly string[]; className?: string }) {
  return <KbdGroup aria-hidden="true" className={className}>{keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</KbdGroup>;
}
