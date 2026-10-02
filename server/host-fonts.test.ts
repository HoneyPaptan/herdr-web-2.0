import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostFonts, cssWeight, parseFcList } from "./host-fonts.ts";

const dir = mkdtempSync(join(tmpdir(), "host-fonts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function line(...fields: string[]): string {
  return fields.join("\t");
}

describe("cssWeight", () => {
  it("maps fontconfig anchors onto CSS weights", () => {
    expect([0, 50, 80, 100, 180, 200, 210].map(cssWeight)).toEqual([100, 300, 400, 500, 600, 700, 900]);
  });

  it("interpolates between anchors and clamps the ends", () => {
    expect(cssWeight(140)).toBe(550);
    expect(cssWeight(-5)).toBe(100);
    expect(cssWeight(300)).toBe(1000);
  });
});

describe("parseFcList", () => {
  const output = [
    line("Geist Mono", "Regular", "80", "0", "100", "0", "GeistMono-Regular", "/f/GeistMono-Regular.otf"),
    line("Geist Mono", "Bold Italic", "200", "100", "100", "0", "GeistMono-BoldItalic", "/f/GeistMono-BoldItalic.ttf"),
    line("Inter", "", "[0 215]", "0", "", "0", "Inter", "/f/Inter.ttf"),
    line("Noto CJK", "Regular", "80", "0", "", "1", "NotoCJK", "/f/NotoCJK.ttc"),
    line("Noto CJK", "Regular", "80", "0", "", "0", "NotoCJK", "/f/NotoCJK.ttc"),
    line("Bitmap", "Regular", "80", "0", "", "0", "Bitmap", "/f/bitmap.pcf.gz"),
    line("Geist Mono", "Regular", "80", "0", "100", "0", "GeistMono-Regular", "/f/GeistMono-Regular.otf"),
    "",
  ].join("\n");
  const { report, files } = parseFcList(output);

  it("keeps only standalone ttf and otf files, once each", () => {
    expect(report.families.map((family) => family.family)).toEqual(["Geist Mono", "Inter"]);
    expect(files.size).toBe(3);
  });

  it("describes each face for an @font-face rule", () => {
    const [mono, inter] = report.families;
    expect(mono!.mono).toBe(true);
    expect(mono!.faces.map(({ weight, style, format, postscript }) => ({ weight, style, format, postscript }))).toEqual([
      { weight: "400", style: "normal", format: "opentype", postscript: "GeistMono-Regular" },
      { weight: "700", style: "italic", format: "truetype", postscript: "GeistMono-BoldItalic" },
    ]);
    expect(inter!.mono).toBe(false);
    expect(inter!.faces[0]!.weight).toBe("100 1000");
  });

  it("gives every face a stable opaque id", () => {
    const again = parseFcList(output);
    expect([...again.files.keys()]).toEqual([...files.keys()]);
    for (const id of files.keys()) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("createHostFonts", () => {
  const fontPath = join(dir, "Face.ttf");
  writeFileSync(fontPath, "font-bytes");
  const index = parseFcList([
    line("Face", "Regular", "80", "0", "", "0", "Face-Regular", fontPath),
    line("Gone", "Regular", "80", "0", "", "0", "Gone-Regular", join(dir, "Gone.otf")),
  ].join("\n"));
  let scans = 0;
  const handle = createHostFonts(async () => { scans += 1; return index; });
  const [faceId, goneId] = [...index.files.keys()];

  it("lists families and scans once while cached", async () => {
    const first = await handle(new Request("http://x/api/fonts"), "/api/fonts");
    await handle(new Request("http://x/api/fonts"), "/api/fonts");
    expect(first.status).toBe(200);
    expect((await first.json()).families.map((family: { family: string }) => family.family)).toEqual(["Face", "Gone"]);
    expect(scans).toBe(1);
  });

  it("serves a scanned face with its font type", async () => {
    const response = await handle(new Request(`http://x/api/fonts/${faceId}`), `/api/fonts/${faceId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/ttf");
    expect(await response.text()).toBe("font-bytes");
  });

  it("refuses ids outside the scan, missing files and paths", async () => {
    for (const id of [goneId, "0123456789abcdef", "..%2Fetc%2Fpasswd", ""]) {
      const response = await handle(new Request(`http://x/api/fonts/${id}`), `/api/fonts/${id}`);
      expect(response.status).toBe(404);
    }
  });

  it("rejects writes", async () => {
    const response = await handle(new Request("http://x/api/fonts", { method: "POST" }), "/api/fonts");
    expect(response.status).toBe(405);
  });
});
