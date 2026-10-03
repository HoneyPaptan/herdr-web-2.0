import { join } from "node:path";

import type { ChangeDiff, ChangedFile, ChangeStatus, PaneChanges } from "../shared/changes.ts";
import { git } from "./git.ts";

const MAX_FILES = 500;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_COUNTED_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_000;

const STATUS_LETTERS: Record<string, ChangeStatus> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "added", T: "modified" };

async function repoRoot(cwd: string): Promise<string | null> {
  const { code, stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return code === 0 ? stdout.trim() || null : null;
}

async function baseRevision(root: string): Promise<string> {
  const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  if (head.code === 0) return "HEAD";
  const empty = await git(root, ["hash-object", "-t", "tree", "/dev/null"]);
  return empty.stdout.trim();
}

function parseNameStatus(output: string): Map<string, { status: ChangeStatus; oldPath?: string }> {
  const fields = output.split("\0");
  const statuses = new Map<string, { status: ChangeStatus; oldPath?: string }>();
  for (let index = 0; index < fields.length - 1;) {
    const letter = fields[index]!.charAt(0);
    const status = STATUS_LETTERS[letter] ?? "modified";
    if (letter === "R" || letter === "C") {
      statuses.set(fields[index + 2]!, { status, oldPath: letter === "R" ? fields[index + 1] : undefined });
      index += 3;
    } else {
      statuses.set(fields[index + 1]!, { status });
      index += 2;
    }
  }
  return statuses;
}

function parseNumstat(output: string): { path: string; added: number; removed: number; binary: boolean }[] {
  const fields = output.split("\0");
  const rows: { path: string; added: number; removed: number; binary: boolean }[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const [added = "", removed = "", path = ""] = fields[index]!.split("\t");
    const binary = added === "-";
    if (path === "") {
      rows.push({ path: fields[index + 2]!, added: Number(added) || 0, removed: Number(removed) || 0, binary });
      index += 3;
    } else {
      rows.push({ path, added: Number(added) || 0, removed: Number(removed) || 0, binary });
      index += 1;
    }
  }
  return rows;
}

function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function countLines(bytes: Uint8Array): number {
  let lines = 0;
  for (const byte of bytes) if (byte === 10) lines += 1;
  return bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? lines + 1 : lines;
}

async function untrackedFile(root: string, path: string): Promise<ChangedFile> {
  const file = Bun.file(join(root, path));
  const unknownSize = { path, status: "untracked" as const, added: 0, removed: 0, binary: false };
  try {
    if (file.size > MAX_COUNTED_BYTES) return unknownSize;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksBinary(bytes)) return { ...unknownSize, binary: true };
    return { ...unknownSize, added: countLines(bytes) };
  } catch {
    return unknownSize;
  }
}

async function trackedChanges(root: string, base: string): Promise<ChangedFile[]> {
  const [numstat, nameStatus] = await Promise.all([
    git(root, ["diff", "--no-ext-diff", "--numstat", "-z", "-M", base], 5_000),
    git(root, ["diff", "--no-ext-diff", "--name-status", "-z", "-M", base], 5_000),
  ]);
  if (numstat.code !== 0 || nameStatus.code !== 0) throw new Error("git diff failed");
  const statuses = parseNameStatus(nameStatus.stdout);
  return parseNumstat(numstat.stdout).map((row) => ({ ...row, ...(statuses.get(row.path) ?? { status: "modified" as const }) }));
}

async function untrackedPaths(root: string): Promise<string[]> {
  const { code, stdout } = await git(root, ["ls-files", "-z", "--others", "--exclude-standard"], 5_000);
  return code === 0 ? stdout.split("\0").filter(Boolean) : [];
}

export async function paneChanges(cwd: string): Promise<PaneChanges> {
  const root = await repoRoot(cwd);
  if (root === null) return { root: null, files: [], added: 0, removed: 0, truncated: false };
  const base = await baseRevision(root);
  const [tracked, untracked] = await Promise.all([trackedChanges(root, base), untrackedPaths(root)]);
  const room = Math.max(0, MAX_FILES - tracked.length);
  const files = [...tracked, ...await Promise.all(untracked.slice(0, room).map((path) => untrackedFile(root, path)))]
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_FILES);
  const total = (key: "added" | "removed") => files.reduce((sum, file) => sum + file[key], 0);
  return { root, files, added: total("added"), removed: total("removed"), truncated: tracked.length + untracked.length > files.length };
}

function capPatch(patch: string): ChangeDiff {
  const bytes = new TextEncoder().encode(patch);
  if (bytes.length <= MAX_PATCH_BYTES) return { patch, truncated: false };
  const cut = new TextDecoder().decode(bytes.subarray(0, MAX_PATCH_BYTES));
  return { patch: cut.slice(0, cut.lastIndexOf("\n") + 1), truncated: true };
}

export async function paneChangeDiff(cwd: string, path: string): Promise<ChangeDiff | null> {
  const changes = await paneChanges(cwd);
  const file = changes.files.find((candidate) => candidate.path === path);
  if (!changes.root || !file) return null;
  if (file.binary) return { patch: "", truncated: false };
  if (file.status === "untracked") {
    const { stdout } = await git(changes.root, ["diff", "--no-ext-diff", "--no-index", "--no-color", "--", "/dev/null", file.path], 5_000);
    return capPatch(stdout);
  }
  const base = await baseRevision(changes.root);
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path];
  const { code, stdout } = await git(changes.root, ["diff", "--no-ext-diff", "--no-color", "-M", base, "--", ...paths], 5_000);
  if (code !== 0) throw new Error("git diff failed");
  return capPatch(stdout);
}
