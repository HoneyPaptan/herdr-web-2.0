export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_WIDTH_KEY = "herdr-web-ui:sidebar-width";

type WidthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function clampSidebarWidth(width: number, max: number): number {
  return Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(max, width)));
}

export function readSidebarWidth(given?: WidthStorage): number | null {
  try {
    const width = Number((given ?? window.localStorage).getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(width) && width >= SIDEBAR_MIN_WIDTH ? width : null;
  } catch {
    return null;
  }
}

export function saveSidebarWidth(width: number | null, given?: WidthStorage): void {
  try {
    const storage = given ?? window.localStorage;
    if (width === null) storage.removeItem(SIDEBAR_WIDTH_KEY);
    else storage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    return;
  }
}
