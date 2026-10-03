import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { paneChangeDiff, paneChanges } from "./changes.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=test@example.com", "-c", "user.name=Test", ...args]);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "pane-changes-"));
  roots.push(root);
  return root;
}

function repository(): string {
  const root = scratch();
  run(root, "init", "-q");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "one.txt"), "a\nb\nc\n");
  writeFileSync(join(root, "gone.txt"), "x\n");
  writeFileSync(join(root, "moved.txt"), Array.from({ length: 40 }, (_, line) => `line ${line}`).join("\n") + "\n");
  writeFileSync(join(root, "image.bin"), "\0first");
  run(root, "add", ".");
  run(root, "commit", "-qm", "initial");
  writeFileSync(join(root, "src", "one.txt"), "a\nB\nc\nd\n");
  unlinkSync(join(root, "gone.txt"));
  run(root, "mv", "moved.txt", "renamed.txt");
  writeFileSync(join(root, "image.bin"), "\0second");
  writeFileSync(join(root, "fresh.txt"), "new\nfile");
  return root;
}

describe("paneChanges", () => {
  it("lists tracked, renamed, deleted, binary and untracked files against HEAD", async () => {
    const root = repository();
    const changes = await paneChanges(join(root, "src"));
    expect(changes.root).not.toBeNull();
    expect(changes.files).toEqual([
      { path: "fresh.txt", status: "untracked", added: 2, removed: 0, binary: false },
      { path: "gone.txt", status: "deleted", added: 0, removed: 1, binary: false },
      { path: "image.bin", status: "modified", added: 0, removed: 0, binary: true },
      { path: "renamed.txt", oldPath: "moved.txt", status: "renamed", added: 0, removed: 0, binary: false },
      { path: "src/one.txt", status: "modified", added: 2, removed: 1, binary: false },
    ]);
    expect(changes.added).toBe(4);
    expect(changes.removed).toBe(2);
  });

  it("reports no repository outside git", async () => {
    expect((await paneChanges(scratch())).root).toBeNull();
  });

  it("diffs a repository with no commits against the empty tree", async () => {
    const root = scratch();
    run(root, "init", "-q");
    writeFileSync(join(root, "staged.txt"), "one\n");
    run(root, "add", ".");
    const changes = await paneChanges(root);
    expect(changes.files).toEqual([{ path: "staged.txt", status: "added", added: 1, removed: 0, binary: false }]);
  });
});

describe("paneChangeDiff", () => {
  it("returns the patch of a listed file and refuses any other path", async () => {
    const root = repository();
    expect((await paneChangeDiff(root, "src/one.txt"))?.patch).toContain("@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d\n");
    expect((await paneChangeDiff(root, "fresh.txt"))?.patch).toContain("+new\n+file");
    expect(await paneChangeDiff(root, "../outside.txt")).toBeNull();
    expect(await paneChangeDiff(root, "src/untouched.txt")).toBeNull();
  });
});
