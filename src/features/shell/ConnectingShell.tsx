import { useT } from "../../lib/i18n.ts";
import { Brand } from "./Brand.tsx";

export function ConnectingShell() {
  const t = useT();
  return (
    <div className="app">
      <header className="app-header">
        <Brand />
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <p className="tree-state" role="status">
            Connecting…
          </p>
        </aside>
        <main className="terminal-host">
          <div className="terminal-placeholder">
            <div className="terminal-placeholder-inner">
              <span>{t("Connecting to herdr web ui…")}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
