import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const rendererAssets = path.join(root, 'packages/desktop/src/renderer/assets');
const iconSvgPath = path.join(rendererAssets, 'tomni-icon.svg');
const logoSvgPath = path.join(rendererAssets, 'tomni-logo.svg');
const coreIconSvgPath = path.join(rendererAssets, 'tomny-agentic-icon.svg');
const coreLogoSvgPath = path.join(rendererAssets, 'tomny-agentic-logo.svg');
const iconSvg = await readFile(iconSvgPath);
const logoSvg = await readFile(logoSvgPath);
const coreIconSvg = await readFile(coreIconSvgPath);
const coreLogoSvg = await readFile(coreLogoSvgPath);

const recolorSvg = (source, gradientId, color) => Buffer.from(String(source).replaceAll(`url(#${gradientId})`, color));
const iconWhiteSvg = recolorSvg(iconSvg, 'tomniGradient', '#FFFFFF');
const iconBlackSvg = recolorSvg(iconSvg, 'tomniGradient', '#111116');
const coreIconWhiteSvg = recolorSvg(coreIconSvg, 'tomnyCoreGradient', '#FFFFFF');
const coreIconBlackSvg = recolorSvg(coreIconSvg, 'tomnyCoreGradient', '#111116');

const ensureParent = async (filePath) => mkdir(path.dirname(filePath), { recursive: true });

const writePng = async (input, filePath, width, height = width) => {
  await ensureParent(filePath);
  await sharp(input, { density: 384 })
    .resize(width, height, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(filePath);
};

const iconPngBuffers = new Map();
const iconBuffer = async (size) => {
  if (!iconPngBuffers.has(size)) {
    iconPngBuffers.set(
      size,
      await sharp(iconSvg, { density: 384 })
        .resize(size, size, { fit: 'contain' })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer()
    );
  }
  return iconPngBuffers.get(size);
};

const createIco = async (sizes) => {
  const images = await Promise.all(sizes.map(iconBuffer));
  const headerSize = 6 + sizes.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  sizes.forEach((size, index) => {
    const image = images[index];
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
};

const createIcns = async () => {
  const chunks = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ];
  const payloads = [];
  for (const [type, size] of chunks) {
    const png = await iconBuffer(size);
    const chunk = Buffer.alloc(8 + png.length);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    payloads.push(chunk);
  }
  const totalLength = 8 + payloads.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...payloads]);
};

const pngTargets = [
  ['packages/desktop/src/renderer/assets/tomni-icon.png', 1024, iconSvg],
  ['packages/desktop/src/renderer/assets/tomni-icon-white.png', 1024, iconWhiteSvg],
  ['packages/desktop/src/renderer/assets/tomni-icon-black.png', 1024, iconBlackSvg],
  ['packages/desktop/src/renderer/assets/tomni-logo.png', 1800, logoSvg, 491],
  ['packages/desktop/src/renderer/assets/tomny-agentic-icon.png', 1024, coreIconSvg],
  ['packages/desktop/src/renderer/assets/tomny-agentic-icon-white.png', 1024, coreIconWhiteSvg],
  ['packages/desktop/src/renderer/assets/tomny-agentic-icon-black.png', 1024, coreIconBlackSvg],
  ['packages/desktop/src/renderer/assets/tomny-agentic-logo.png', 1800, coreLogoSvg, 532],
  ['packages/desktop/src/renderer/assets/logos/brand/app.png', 512, iconSvg],
  ['public/pwa/icon-180.png', 180, iconSvg],
  ['public/pwa/icon-192.png', 192, iconSvg],
  ['public/pwa/icon-512.png', 512, iconSvg],
  ['mobile/assets/images/icon.png', 1024, iconSvg],
  ['resources/app.png', 1024, iconSvg],
  ['resources/app_dev.png', 1024, iconSvg],
  ['resources/icon.png', 1024, iconSvg],
  ['resources/tomny_logo_no_border.png', 1800, logoSvg, 491],
  ['resources/tomni-icon.png', 1024, iconSvg],
  ['resources/tomni-icon-white.png', 1024, iconWhiteSvg],
  ['resources/tomni-icon-black.png', 1024, iconBlackSvg],
  ['resources/tomni-logo.png', 1800, logoSvg, 491],
  ['resources/tomny-agentic-icon.png', 1024, coreIconSvg],
  ['resources/tomny-agentic-icon-white.png', 1024, coreIconWhiteSvg],
  ['resources/tomny-agentic-icon-black.png', 1024, coreIconBlackSvg],
  ['resources/tomny-agentic-logo.png', 1800, coreLogoSvg, 532],
];

for (const [relativePath, width, input, height] of pngTargets) {
  await writePng(input, path.join(root, relativePath), width, height ?? width);
}

await writeFile(path.join(root, 'resources/app.ico'), await createIco([16, 24, 32, 48, 64, 128, 256]));
await writeFile(path.join(root, 'resources/app.icns'), await createIcns());
await writeFile(path.join(root, 'resources/tomni-icon.svg'), iconSvg);
await writeFile(path.join(root, 'resources/tomni-icon-white.svg'), iconWhiteSvg);
await writeFile(path.join(root, 'resources/tomni-icon-black.svg'), iconBlackSvg);
await writeFile(path.join(root, 'resources/tomni-logo.svg'), logoSvg);
await writeFile(path.join(root, 'resources/tomny-agentic-icon.svg'), coreIconSvg);
await writeFile(path.join(root, 'resources/tomny-agentic-icon-white.svg'), coreIconWhiteSvg);
await writeFile(path.join(root, 'resources/tomny-agentic-icon-black.svg'), coreIconBlackSvg);
await writeFile(path.join(root, 'resources/tomny-agentic-logo.svg'), coreLogoSvg);
await ensureParent(path.join(root, 'public/assets/logos/brand/tomny-agentic.svg'));
await writeFile(path.join(root, 'public/assets/logos/brand/tomny-agentic.svg'), coreIconSvg);

const blackBackgroundLogo = Buffer.from(
  String(logoSvg).replace(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1320 360" fill="none">',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1320 360" fill="none"><rect width="1320" height="360" rx="40" fill="#0C0C10"/>'
  )
);
await writeFile(path.join(root, 'resources/tomny_logo_black_bg.svg'), blackBackgroundLogo);

console.log('Tomni brand assets generated successfully.');
