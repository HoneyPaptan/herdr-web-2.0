export const PERMISSION_MODES = ["manual", "acceptEdits", "plan", "auto", "yolo", "dontAsk"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface PermissionModes {
  current: PermissionMode | null;
  modes: PermissionMode[];
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}
