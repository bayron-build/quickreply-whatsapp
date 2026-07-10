// scripts/make-icons.mjs — renders the logo SVG to the three required PNG sizes.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#008069"/>
  <path d="M34 44h60v10H34zm0 20h60v10H34zm0 20h36v10H34z" fill="#fff"/>
  <path d="M92 78l14 14-8 4-6-6z" fill="#ffd54f"/>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
  console.log(`icon${size}.png written`);
}
