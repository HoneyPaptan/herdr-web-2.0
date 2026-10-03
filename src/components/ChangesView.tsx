import { memo, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, File, GitCompare } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChangeDiff, ChangedFile, PaneChanges } from "../../shared/changes.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { parsePatch, type PatchLine } from "../lib/unifiedDiff.ts";
import { useNarrow } from "../lib/useNarrow.ts";

const POLL_MS = 5_000;
const PANE_BAR = "flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-ui";
const LINE_TONE: Record<PatchLine["kind"], string> = {
  hunk: "bg-muted/60 text-muted-foreground",
  context: "",
  add: "bg-accent-add/10",
  remove: "bg-destructive/10",
  note: "text-muted-foreground/60",
};
const MARKER: Record<PatchLine["kind"], string> = { hunk: "", context: " ", add: "+", remove: "−", note: "" };
const MARKER_TONE: Record<PatchLine["kind"], string> = { hunk: "", context: "", add: "text-accent-add", remove: "text-destructive", note: "" };

type Load<T> = { value: T | null; error: string | null };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function usePaneChanges(paneId: string): Load<PaneChanges> {
  const { fetchPaneChanges } = useMachineApi();
  const [state, setState] = useState<Load<PaneChanges> & { key: string }>({ value: null, error: null, key: "" });
  useEffect(() => {
    let live = true;
    let previous = "";
    setState({ value: null, error: null, key: "" });
    const read = (): void => {
      if (document.visibilityState === "hidden") return;
      fetchPaneChanges(paneId).then((value) => {
        const key = JSON.stringify(value);
        if (!live || key === previous) return;
        previous = key;
        setState({ value, error: null, key });
      }, (error: unknown) => {
        if (live) setState((current) => ({ ...current, error: errorText(error) }));
      });
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [paneId, fetchPaneChanges]);
  return state;
}

function fileVersion(file: ChangedFile): string {
  return `${file.status}:${file.oldPath ?? ""}:${file.path}:${file.added}:${file.removed}`;
}

function useChangeDiff(paneId: string, file: ChangedFile | null): Load<ChangeDiff> {
  const { fetchPaneChangeDiff } = useMachineApi();
  const [state, setState] = useState<Load<ChangeDiff>>({ value: null, error: null });
  const version = file ? fileVersion(file) : null;
  const path = file?.path ?? null;
  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState({ value: null, error: null });
    fetchPaneChangeDiff(paneId, path).then(
      (value) => { if (live) setState({ value, error: null }); },
      (error: unknown) => { if (live) setState({ value: null, error: errorText(error) }); },
    );
    return () => { live = false; };
  }, [paneId, path, version, fetchPaneChangeDiff]);
  return state;
}

function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? { dir: "", name: path } : { dir: path.slice(0, slash), name: path.slice(slash + 1) };
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-ui">
      {added > 0 && <span className="text-accent-add">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-destructive">{"−"}{removed}</span>}
    </span>
  );
}

function FileName({ file }: { file: ChangedFile }) {
  const { dir, name } = splitPath(file.path);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="shrink-0 text-sidebar-foreground">{name}</span>
      {dir && <span className="min-w-0 truncate text-muted-foreground">{dir}</span>}
      {file.oldPath && <span className="shrink-0 text-muted-foreground">{"←"} {splitPath(file.oldPath).name}</span>}
    </span>
  );
}

function FileStat({ file }: { file: ChangedFile }) {
  const t = useT();
  return file.binary ? <span className="shrink-0 text-muted-foreground">{t("binary")}</span> : <Counts added={file.added} removed={file.removed} />;
}

const FileRow = memo(function FileRow({ file, selected, onSelect }: { file: ChangedFile; selected: boolean; onSelect: (path: string) => void }) {
  return (
    <button
      type="button"
      data-slot="changes-file"
      aria-label={file.path}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(file.path)}
      className={cn(
        "flex w-full shrink-0 cursor-pointer items-center gap-2 py-1.5 pr-3 pl-3 text-left text-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset pointer-coarse:min-h-9",
        selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50",
      )}
    >
      <File aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 text-muted-foreground" />
      <FileName file={file} />
      <FileStat file={file} />
    </button>
  );
});

function Centered({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("m-0 flex min-h-0 flex-1 items-center justify-center p-8 text-center text-ui", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {children}
    </p>
  );
}

function PatchRows({ lines }: { lines: PatchLine[] }) {
  return (
    <div className="min-w-max font-mono text-code">
      {lines.map((line, index) => (
        <div key={index} className={cn("flex", LINE_TONE[line.kind])}>
          <span aria-hidden="true" className="w-12 shrink-0 pr-3 text-right text-muted-foreground/60 tabular-nums select-none">{line.newLine ?? line.oldLine ?? ""}</span>
          <span aria-hidden="true" className={cn("w-4 shrink-0 select-none", MARKER_TONE[line.kind])}>{MARKER[line.kind]}</span>
          <span className="pr-4 whitespace-pre">{line.kind === "hunk" ? `@@ ${line.text}` : line.text}</span>
        </div>
      ))}
    </div>
  );
}

function DiffBody({ paneId, file }: { paneId: string; file: ChangedFile }) {
  const t = useT();
  const diff = useChangeDiff(paneId, file);
  if (file.binary) return <Centered>{t("No text diff for this file.")}</Centered>;
  if (diff.error) return <Centered tone="error">{diff.error}</Centered>;
  if (!diff.value) return <Centered>{t("Loading…")}</Centered>;
  const lines = parsePatch(diff.value.patch);
  if (lines.length === 0) return <Centered>{t("No line changes, only the file mode or name.")}</Centered>;
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <PatchRows lines={lines} />
      {diff.value.truncated && <p className="m-0 px-3 py-2 text-ui text-muted-foreground">{t("Diff cut short: too large to show in full.")}</p>}
    </div>
  );
}

function DiffPane({ paneId, file, onBack }: { paneId: string; file: ChangedFile | null; onBack?: () => void }) {
  const t = useT();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={PANE_BAR}>
        {onBack && (
          <button type="button" data-slot="changes-back" onClick={onBack} className="-ml-1 flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1 py-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t("Files")}
          </button>
        )}
        {file && <FileName file={file} />}
        {file && <FileStat file={file} />}
      </div>
      {file ? <DiffBody key={file.path} paneId={paneId} file={file} /> : <Centered>{t("Select a file to see what changed.")}</Centered>}
    </div>
  );
}

function FileListPane({ changes, selected, onSelect, className }: { changes: PaneChanges; selected: string | null; onSelect: (path: string) => void; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className={PANE_BAR}>
        <span className="text-sidebar-foreground">{t("Uncommitted")}</span>
        <span className="text-muted-foreground">{changes.files.length}</span>
        <Counts added={changes.added} removed={changes.removed} />
      </div>
      <div role="list" aria-label={t("Changed files")} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {changes.files.map((file) => (
          <div key={file.path} role="listitem" className="flex">
            <FileRow file={file} selected={file.path === selected} onSelect={onSelect} />
          </div>
        ))}
        {changes.truncated && <p className="m-0 px-3 py-2 text-ui text-muted-foreground/60">{t("Showing the first {n} files.", { n: changes.files.length })}</p>}
      </div>
    </div>
  );
}

function NoChanges() {
  const t = useT();
  return (
    <p role="status" className="m-0 flex min-h-0 flex-1 items-center justify-center gap-2 p-8 text-ui text-sidebar-foreground">
      <GitCompare aria-hidden="true" strokeWidth={1.5} className="size-4 shrink-0 text-muted-foreground" />
      {t("No uncommitted changes.")}
    </p>
  );
}

export function ChangesView({ paneId }: { paneId: string }) {
  const t = useT();
  const narrow = useNarrow();
  const changes = usePaneChanges(paneId);
  const [picked, setPicked] = useState<string | null>(null);
  const [listShown, setListShown] = useState(true);
  const value = changes.value;
  if (changes.error && !value) return <Centered tone="error">{changes.error}</Centered>;
  if (!value) return <Centered>{t("Reading the working tree…")}</Centered>;
  if (value.root === null) return <Centered>{t("This session is not in a git repository.")}</Centered>;
  if (value.files.length === 0) return <NoChanges />;
  const selected = value.files.find((file) => file.path === picked) ?? (narrow ? null : value.files[0] ?? null);
  const select = (path: string): void => {
    setPicked(path);
    if (narrow) setListShown(false);
  };
  if (narrow) {
    return listShown || !selected
      ? <FileListPane changes={value} selected={selected?.path ?? null} onSelect={select} className="flex-1" />
      : <DiffPane paneId={paneId} file={selected} onBack={() => setListShown(true)} />;
  }
  return (
    <div className="flex min-h-0 flex-1">
      <FileListPane changes={value} selected={selected?.path ?? null} onSelect={select} className="w-72 shrink-0 border-r border-border" />
      <DiffPane paneId={paneId} file={selected} />
    </div>
  );
}
