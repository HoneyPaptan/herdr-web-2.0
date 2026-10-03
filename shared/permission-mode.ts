export const PERMISSION_MODES = ["manual", "acceptEdits", "plan", "auto", "yolo", "dontAsk"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface PermissionModes {
  current: PermissionMode | null;
  modes: PermissionMode[];
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

export const PERMISSION_MODE_AGENTS = ["claude", "gemini"] as const;

export type PermissionModeAgent = (typeof PERMISSION_MODE_AGENTS)[number];

export function hasPermissionModes(agent: string | null): agent is PermissionModeAgent {
  return agent !== null && (PERMISSION_MODE_AGENTS as readonly string[]).includes(agent);
}
