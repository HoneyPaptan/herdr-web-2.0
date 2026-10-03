export const EDGE_PX = 24;
export const SWIPE_PX = 56;
const SLOP_PX = 10;
const OFF_EDGE_AXIS_RATIO = 2;

export type SwipeVerdict = "open" | "close" | "claim" | "pending" | "ignore";

function axisRatio(drawerOpen: boolean, startX: number): number {
  return !drawerOpen && startX > EDGE_PX ? OFF_EDGE_AXIS_RATIO : 1;
}

export function swipeVerdict(drawerOpen: boolean, startX: number, dx: number, dy: number): SwipeVerdict {
  if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return "pending";
  if (Math.abs(dy) * axisRatio(drawerOpen, startX) >= Math.abs(dx)) return "ignore";
  if (!drawerOpen && dx > 0) return dx >= SWIPE_PX ? "open" : "claim";
  if (drawerOpen && dx < 0) return -dx >= SWIPE_PX ? "close" : "claim";
  return "ignore";
}

const MODAL = "[aria-modal='true'], dialog[open]";

function scrolledAside(target: EventTarget | null): boolean {
  for (let node = target as HTMLElement | null; node; node = node.parentElement) {
    if (node.scrollLeft > 0 && node.scrollWidth > node.clientWidth) return true;
  }
  return false;
}

function editable(target: EventTarget | null): boolean {
  for (let node = target as HTMLElement | null; node; node = node.parentElement) {
    if (node.isContentEditable === true || /^(?:INPUT|TEXTAREA|SELECT)$/.test(node.tagName ?? "")) return true;
  }
  return false;
}

function selecting(): boolean {
  const selection = document.getSelection?.() ?? null;
  return selection !== null && !selection.isCollapsed;
}

export function watchDrawerSwipe(isOpen: () => boolean, setOpen: (open: boolean) => void): () => void {
  const narrow = window.matchMedia("(max-width: 768px)");
  let start: { x: number; y: number; open: boolean } | null = null;
  let claimed = false;
  let done = false;
  const onStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    const open = isOpen();
    start = event.touches.length === 1 && touch && narrow.matches && document.querySelector(MODAL) === null && (open || !scrolledAside(event.target))
      && !editable(event.target) && !selecting()
      ? { x: touch.clientX, y: touch.clientY, open } : null;
    claimed = false;
    done = false;
  };
  const onMove = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (start === null || !touch) return;
    if (!narrow.matches) { onEnd(); return; }
    if (!done && selecting()) { onEnd(); return; }
    const verdict = done ? "claim" : swipeVerdict(start.open, start.x, touch.clientX - start.x, touch.clientY - start.y);
    if (!claimed && verdict === "pending") return;
    if (verdict === "ignore") { onEnd(); return; }
    claimed = true;
    event.preventDefault();
    event.stopPropagation();
    if (!done && (verdict === "open" || verdict === "close")) {
      setOpen(verdict === "open");
      done = true;
    }
  };
  const onEnd = (): void => { start = null; claimed = false; done = false; };
  document.addEventListener("touchstart", onStart, { capture: true, passive: true });
  document.addEventListener("touchmove", onMove, { capture: true, passive: false });
  document.addEventListener("touchend", onEnd, { capture: true, passive: true });
  document.addEventListener("touchcancel", onEnd, { capture: true, passive: true });
  return () => {
    document.removeEventListener("touchstart", onStart, { capture: true });
    document.removeEventListener("touchmove", onMove, { capture: true });
    document.removeEventListener("touchend", onEnd, { capture: true });
    document.removeEventListener("touchcancel", onEnd, { capture: true });
  };
}
