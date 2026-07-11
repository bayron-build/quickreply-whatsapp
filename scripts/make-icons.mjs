// scripts/make-icons.mjs — renders the logo SVG to the three required PNG sizes.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#008069"/>
  <path d="M64 16c-28 0-50 17-50 40 0 13 7 25 19 32l-6 22 25-12c4 1 8 1 12 1 28 0 50-17 50-43S92 16 64 16z" fill="#fff"/>
  <path d="M74 28 44 63h16l-8 33 30-38H60z" fill="#008069"/>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
  console.log(`icon${size}.png written`);
}
