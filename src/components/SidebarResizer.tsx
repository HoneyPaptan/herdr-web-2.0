import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "../lib/i18n.ts";
import { clampSidebarWidth, readSidebarWidth, saveSidebarWidth, SIDEBAR_MIN_WIDTH } from "../lib/sidebarWidth.ts";

const KEY_STEP = 16;

function sidebarOf(handle: HTMLElement | null): HTMLElement | null {
  return handle?.parentElement ?? null;
}

function defaultWidth(sidebar: HTMLElement): number {
  return parseFloat(getComputedStyle(sidebar).getPropertyValue("--sidebar-w")) || sidebar.getBoundingClientRect().width;
}

export function SidebarResizer() {
  const t = useT();
  const handle = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  const [width, setWidth] = useState(readSidebarWidth);
  const [max, setMax] = useState(0);

  useLayoutEffect(() => {
    const sidebar = sidebarOf(handle.current);
    if (sidebar) setMax(defaultWidth(sidebar));
  }, []);
  useLayoutEffect(() => {
    const sidebar = sidebarOf(handle.current);
    if (!sidebar) return;
    if (width === null) sidebar.style.removeProperty("--sidebar-size");
    else sidebar.style.setProperty("--sidebar-size", `${width}px`);
  }, [width]);

  const choose = (next: number | null, save: boolean): void => {
    const sidebar = sidebarOf(handle.current);
    if (!sidebar) return;
    const limit = defaultWidth(sidebar);
    const chosen = next === null || next >= limit ? null : clampSidebarWidth(next, limit);
    setMax(limit);
    setWidth(chosen);
    if (save) saveSidebarWidth(chosen);
  };
  const dragTo = (event: PointerEvent<HTMLDivElement>, save: boolean): void => {
    if (start.current) choose(start.current.width + event.clientX - start.current.x, save);
  };
  const beginDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const sidebar = sidebarOf(handle.current);
    if (event.button !== 0 || !sidebar) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width: sidebar.getBoundingClientRect().width };
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    dragTo(event, true);
    start.current = null;
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = width ?? max;
    const next = { ArrowLeft: current - KEY_STEP, ArrowRight: current + KEY_STEP, Home: SIDEBAR_MIN_WIDTH, End: null }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next, true);
  };

  return (
    <div
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize sidebar")}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={max}
      aria-valuenow={width ?? max}
      tabIndex={0}
      className="sidebar-resizer absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none select-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring max-md:hidden"
      onPointerDown={beginDrag}
      onPointerMove={(event) => dragTo(event, false)}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => choose(null, true)}
      onKeyDown={resizeByKey}
    />
  );
}
