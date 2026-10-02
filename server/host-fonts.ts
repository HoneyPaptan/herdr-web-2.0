import { createHash } from "node:crypto";
import type { HostFontFace, HostFontFamily, HostFontsReport } from "../shared/protocol.ts";
import { jsonResponse } from "./http.ts";

const FC_FORMAT = "%{family[0]}\\t%{style[0]}\\t%{weight}\\t%{slant}\\t%{spacing}\\t%{index}\\t%{postscriptname}\\t%{file}\\n";
const FC_MONO_SPACING = 100;
const FC_ROMAN_SLANT = 0;
const SCAN_TTL_MS = 60_000;
const FONT_ID = /^[0-9a-f]{16}$/;
const FILE_FORMATS: Record<string, HostFontFace["format"]> = { ttf: "truetype", otf: "opentype" };
const CONTENT_TYPES: Record<HostFontFace["format"], string> = { truetype: "font/ttf", opentype: "font/otf" };

const FC_TO_CSS_WEIGHT: readonly (readonly [number, number])[] = [
  [0, 100], [40, 200], [50, 300], [55, 350], [75, 380], [80, 400],
  [100, 500], [180, 600], [200, 700], [205, 800], [210, 900], [215, 1000],
];

export function cssWeight(fc: number): number {
  const last = FC_TO_CSS_WEIGHT[FC_TO_CSS_WEIGHT.length - 1]!;
  if (fc >= last[0]) return last[1];
  if (fc <= 0) return FC_TO_CSS_WEIGHT[0]![1];
  const upper = FC_TO_CSS_WEIGHT.findIndex(([point]) => point >= fc);
  const [fcHigh, cssHigh] = FC_TO_CSS_WEIGHT[upper]!;
  const [fcLow, cssLow] = FC_TO_CSS_WEIGHT[upper - 1]!;
  return Math.round(cssLow + ((fc - fcLow) / (fcHigh - fcLow)) * (cssHigh - cssLow));
}

function weightDescriptor(raw: string): string | null {
  const range = /^\[(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)\]$/.exec(raw);
  if (range) return `${cssWeight(Number(range[1]))} ${cssWeight(Number(range[2]))}`;
  const single = Number(raw);
  return raw !== "" && Number.isFinite(single) ? String(cssWeight(single)) : null;
}

function fileFormat(file: string): HostFontFace["format"] | null {
  return FILE_FORMATS[file.slice(file.lastIndexOf(".") + 1).toLowerCase()] ?? null;
}

function faceId(file: string): string {
  return createHash("sha256").update(file).digest("hex").slice(0, 16);
}

export interface HostFontIndex {
  report: HostFontsReport;
  files: Map<string, { file: string; format: HostFontFace["format"] }>;
}

export function parseFcList(output: string): HostFontIndex {
  const families = new Map<string, HostFontFamily>();
  const files = new Map<string, { file: string; format: HostFontFace["format"] }>();
  for (const line of output.split("\n")) {
    const [family, , weightRaw, slant, spacing, index, postscript, file] = line.split("\t");
    if (!family || !file || index !== "0") continue;
    const format = fileFormat(file);
    const weight = weightDescriptor(weightRaw ?? "");
    if (format === null || weight === null) continue;
    const id = faceId(file);
    if (files.has(id)) continue;
    files.set(id, { file, format });
    const entry = families.get(family) ?? { family, mono: false, faces: [] };
    entry.mono ||= Number(spacing) === FC_MONO_SPACING;
    entry.faces.push({ id, weight, style: Number(slant) === FC_ROMAN_SLANT ? "normal" : "italic", format, postscript: postscript ?? "" });
    families.set(family, entry);
  }
  const sorted = [...families.values()].sort((a, b) => a.family.localeCompare(b.family));
  return { report: { families: sorted }, files };
}

async function scanHostFonts(): Promise<HostFontIndex> {
  try {
    const proc = Bun.spawn(["fc-list", "--format", FC_FORMAT], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? parseFcList(output) : parseFcList("");
  } catch {
    return parseFcList("");
  }
}

export function createHostFonts(scan: () => Promise<HostFontIndex> = scanHostFonts) {
  let cached: { at: number; index: Promise<HostFontIndex> } | null = null;
  const current = (): Promise<HostFontIndex> => {
    if (cached === null || Date.now() - cached.at > SCAN_TTL_MS) cached = { at: Date.now(), index: scan() };
    return cached.index;
  };
  return async function handleHostFontsRequest(request: Request, pathname: string): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return jsonResponse({ error: { code: "method_not_allowed", message: "use GET" } }, 405);
    const index = await current();
    if (pathname === "/api/fonts") return jsonResponse(index.report, 200, { "cache-control": "no-store" });
    const id = pathname.slice("/api/fonts/".length);
    const face = FONT_ID.test(id) ? index.files.get(id) : undefined;
    const file = face === undefined ? null : Bun.file(face.file);
    if (face === undefined || file === null || !(await file.exists())) return jsonResponse({ error: { code: "not_found", message: "font not found" } }, 404);
    return new Response(file, { headers: { "content-type": CONTENT_TYPES[face.format], "cache-control": "private, max-age=86400" } });
  };
}
