import type { HostFontFace, HostFontFamily, HostFontsReport } from "../../shared/protocol.ts";

const NO_FONTS: HostFontsReport = { families: [] };
const UNSAFE_NAME = /["\\]/g;

let report: Promise<HostFontsReport> | null = null;
const registered = new Set<string>();

async function fetchReport(): Promise<HostFontsReport> {
  const response = await fetch("/api/fonts");
  if (!response.ok) throw new Error(`fonts ${response.status}`);
  return await response.json() as HostFontsReport;
}

export function hostFonts(): Promise<HostFontsReport> {
  report ??= fetchReport().catch(() => {
    report = null;
    return NO_FONTS;
  });
  return report;
}

function familyNames(stack: string): string[] {
  return stack.split(",").map((name) => name.trim().replace(/^["']|["']$/g, "")).filter((name) => name !== "");
}

function faceSource(face: HostFontFace): string {
  const local = face.postscript === "" ? "" : `local("${face.postscript.replace(UNSAFE_NAME, "")}"), `;
  return `${local}url("/api/fonts/${face.id}") format("${face.format}")`;
}

function register(family: HostFontFamily): void {
  registered.add(family.family);
  for (const face of family.faces) {
    document.fonts.add(new FontFace(family.family, faceSource(face), { weight: face.weight, style: face.style }));
  }
}

export async function registerHostFonts(stack: string): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts) return;
  const wanted = familyNames(stack).filter((name) => !registered.has(name));
  if (wanted.length === 0) return;
  const { families } = await hostFonts();
  for (const family of families) if (wanted.includes(family.family) && !registered.has(family.family)) register(family);
}
