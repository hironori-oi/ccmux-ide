#!/usr/bin/env node
/**
 * generate-icons.mjs
 *
 * Generates all raster icon assets from the master SVG sources under
 *   site/public/brand/app-icon-1024.svg  (the source of truth)
 *   site/public/brand/og.svg             (OG card)
 *
 * Outputs:
 *   site/public/brand/app-icon-{32,64,128,128@2x,256,512,1024}.png
 *   site/public/brand/og.png (1200x630)
 *   site/public/favicon-32.png  (for fallback PNG favicons; .ico requires extra tool)
 *
 * It does NOT overwrite anything in src-tauri/icons/. The brand-migration
 * step is explicitly separate (see BRAND.md).
 *
 * Usage:
 *   node scripts/generate-icons.mjs
 *
 * Dependencies: sharp (ships with Next.js; no install needed in this repo).
 *
 * To convert PNG -> .ico for Windows, use a separate tool after running this:
 *   npx png-to-ico site/public/brand/app-icon-256.png > site/public/favicon.ico
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const brandDir = join(root, "public", "brand");
const publicDir = join(root, "public");

async function ensureDir(d) {
  await mkdir(d, { recursive: true });
}

async function renderSvgToPng(svgPath, outPath, size) {
  const svg = await readFile(svgPath);
  // Clamp density so we don't blow past sharp's pixel limit for large sizes.
  // The master SVG viewBox is 1024; we render at a density that aims for
  // roughly the target raster size and let sharp resample down.
  const density = Math.min(384, Math.max(72, Math.ceil((size / 1024) * 288)));
  await sharp(svg, { density })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`  -> ${outPath} (${size}x${size})`);
}

async function renderOg(svgPath, outPath) {
  const svg = await readFile(svgPath);
  await sharp(svg, { density: 144 })
    .resize(1200, 630, { fit: "contain", background: { r: 12, g: 14, b: 18, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`  -> ${outPath} (1200x630)`);
}

async function main() {
  await ensureDir(brandDir);

  const appIconSrc = join(brandDir, "app-icon-1024.svg");
  const ogSrc = join(brandDir, "og.svg");

  console.log("[sumi] Generating app icons from app-icon-1024.svg");
  const sizes = [32, 64, 128, 256, 512, 1024];
  for (const s of sizes) {
    await renderSvgToPng(appIconSrc, join(brandDir, `app-icon-${s}.png`), s);
  }
  // 128@2x is 256 at render time
  await renderSvgToPng(appIconSrc, join(brandDir, "app-icon-128@2x.png"), 256);

  console.log("\n[sumi] Generating favicon PNG (32px) at site root");
  await renderSvgToPng(appIconSrc, join(publicDir, "favicon-32.png"), 32);

  console.log("\n[sumi] Generating OG image from og.svg");
  await renderOg(ogSrc, join(brandDir, "og.png"));

  console.log("\n[sumi] Done.");
  console.log("\nNext steps (manual, when ready to flip the app brand):");
  console.log("  1. npx png-to-ico public/brand/app-icon-256.png > public/favicon.ico");
  console.log("  2. Replace src-tauri/icons/* with the generated sizes (see BRAND.md).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
