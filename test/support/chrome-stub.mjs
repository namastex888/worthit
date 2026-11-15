// Executable Chrome replacement for isolated CLI fixtures. No browser or network.
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const crc = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
export function fixturePng(width = 1600, height = 900) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body));
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
export function installChromeStub(bin) {
  const executable = path.join(bin, 'fixture-chrome');
  fs.writeFileSync(executable, `#!${process.execPath}\nimport { chromeMain } from ${JSON.stringify(import.meta.url)}; chromeMain();\n`, { mode: 0o755 });
  return executable;
}
export function chromeMain() {
  const args = process.argv.slice(2), png = args.find(a => a.startsWith('--screenshot='))?.slice(13);
  const mode = process.env.FIXTURE_CHROME_MODE || 'exit0';
  fs.appendFileSync(process.env.FIXTURE_CHROME_TRACE, JSON.stringify({ command: 'headless-chrome', args, png }) + '\n');
  if (!['none', 'no-write-zero'].includes(mode)) {
    let bytes = fixturePng(mode === 'wrong-size' ? 1 : 1600, mode === 'wrong-size' ? 1 : 900);
    if (mode === 'invalid') bytes = Buffer.from('not a PNG');
    if (mode === 'truncated') bytes = bytes.subarray(0, bytes.length - 15);
    fs.writeFileSync(png, bytes);
    if (mode === 'old') fs.utimesSync(png, 1, 1);
  }
  if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
  else process.exit(mode === 'exit2' || mode === 'none' ? 2 : 0);
}
