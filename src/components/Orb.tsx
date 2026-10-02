import { ThinkingOrb, type ThinkingOrbProps } from "thinking-orbs";

import { useSettings } from "../lib/settings.ts";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION).matches === true;
}

export function Orb({ style, paused, ...props }: Omit<ThinkingOrbProps, "theme" | "size">) {
  const { resolvedTheme } = useSettings();
  return <ThinkingOrb theme={resolvedTheme} size={20} paused={paused ?? prefersReducedMotion()} style={{ willChange: "transform", ...style }} {...props} />;
}
