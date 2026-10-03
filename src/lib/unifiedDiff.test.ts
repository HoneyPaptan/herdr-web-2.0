import { describe, expect, it } from "bun:test";

import { parsePatch } from "./unifiedDiff.ts";

const PATCH = [
  "diff --git a/src/one.txt b/src/one.txt",
  "index 1111111..2222222 100644",
  "--- a/src/one.txt",
  "+++ b/src/one.txt",
  "@@ -1,3 +1,4 @@ export function one() {",
  " a",
  "-b",
  "+B",
  " c",
  "+d",
  "\\ No newline at end of file",
  "",
].join("\n");

describe("parsePatch", () => {
  it("numbers each side and drops the file header", () => {
    expect(parsePatch(PATCH)).toEqual([
      { kind: "hunk", text: "export function one() {", oldLine: null, newLine: null },
      { kind: "context", text: "a", oldLine: 1, newLine: 1 },
      { kind: "remove", text: "b", oldLine: 2, newLine: null },
      { kind: "add", text: "B", oldLine: null, newLine: 2 },
      { kind: "context", text: "c", oldLine: 3, newLine: 3 },
      { kind: "add", text: "d", oldLine: null, newLine: 4 },
      { kind: "note", text: "No newline at end of file", oldLine: null, newLine: null },
    ]);
  });

  it("starts numbering at each hunk and ignores a second file header", () => {
    const rows = parsePatch("@@ -10 +12,2 @@\n x\n+y\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n");
    expect(rows.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([["hunk", null, null], ["context", 10, 12], ["add", null, 13]]);
  });

  it("returns nothing for an empty patch", () => {
    expect(parsePatch("")).toEqual([]);
  });
});
