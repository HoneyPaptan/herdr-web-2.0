const BUILD_SCRIPT = /\/assets\/index-[\w-]+\.js/;
const BUILD_CHECK_MS = 5 * 60_000;

let staleBuild = false;

function runningBuild(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return script?.getAttribute("src")?.match(BUILD_SCRIPT)?.[0] ?? null;
}

async function servedBuild(): Promise<string | null> {
  try {
    const response = await fetch("/", { cache: "no-store" });
    return response.ok ? (await response.text()).match(BUILD_SCRIPT)?.[0] ?? null : null;
  } catch {
    return null;
  }
}

async function checkBuild(current: string): Promise<void> {
  if (staleBuild) return;
  const served = await servedBuild();
  if (served === null || served === current) return;
  staleBuild = true;
  if (document.visibilityState === "hidden") location.reload();
}

function watchBuild(): void {
  const current = runningBuild();
  if (current === null) return;
  document.addEventListener("visibilitychange", () => {
    if (staleBuild && document.visibilityState === "hidden") location.reload();
    else if (document.visibilityState === "visible") void checkBuild(current).then(() => { if (staleBuild) location.reload(); });
  });
  setInterval(() => void checkBuild(current), BUILD_CHECK_MS);
}

window.addEventListener("load", () => {
  watchBuild();
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("service worker registration failed", err);
  });
});
