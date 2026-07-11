// scripts/make-icons.mjs — renders the logo SVG to the three required PNG sizes.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#008069"/>
  <path d="M64 22c-26 0-46 17-46 38 0 12 7 23 18 30l-4 18 20-10c4 .7 8 1 12 1 26 0 46-17 46-39s-20-38-46-38z" fill="#fff"/>
  <path d="M70 34 48 66h14l-8 26 28-38H66l10-20z" fill="#008069"/>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
  console.log(`icon${size}.png written`);
}
