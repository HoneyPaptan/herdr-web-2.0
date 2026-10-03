export type PatchLineKind = "hunk" | "context" | "add" | "remove" | "note";

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

function patchLines(patch: string): string[] {
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function parsePatch(patch: string): PatchLine[] {
  const rows: PatchLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patchLines(patch)) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: header[3] ?? "", oldLine: null, newLine: null });
      continue;
    }
    if (!inHunk) continue;
    const marker = line.charAt(0);
    const text = line.slice(1);
    if (marker === "+") rows.push({ kind: "add", text, oldLine: null, newLine: newLine++ });
    else if (marker === "-") rows.push({ kind: "remove", text, oldLine: oldLine++, newLine: null });
    else if (marker === " " || line === "") rows.push({ kind: "context", text, oldLine: oldLine++, newLine: newLine++ });
    else if (marker === "\\") rows.push({ kind: "note", text: line.slice(2), oldLine: null, newLine: null });
    else inHunk = false;
  }
  return rows;
}
