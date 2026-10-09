// Captures the actual Android framebuffer. It does not render HTML or fabricate native UI.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../artifacts/fieldnotes-implementation');
const relative = process.argv[2];
if (!relative || !relative.endsWith('.png')) throw new Error('Pass a PNG path relative to artifacts/fieldnotes-implementation.');
const target = path.resolve(root, relative);
if (!target.startsWith(root + path.sep)) throw new Error('Capture target must stay inside the Fieldnotes artifact folder.');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const device = 'emulator-5554';
const buffer = cp.execFileSync(adb, ['-s', device, 'exec-out', 'screencap', '-p'], { maxBuffer: 24 * 1024 * 1024 });
if (buffer.subarray(1, 4).toString() !== 'PNG') throw new Error('ADB did not return a PNG.');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, buffer);
const readAdb = (...args) => cp.execFileSync(adb, ['-s', device, ...args], { encoding: 'utf8' }).trim();
const metadata = {
  platform: 'Android', device: 'Pixel 8a AVD', deviceId: device,
  width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20),
  density: readAdb('shell', 'wm', 'density'), fontScale: Number(readAdb('shell', 'settings', 'get', 'system', 'font_scale')),
  route: process.argv[3] || 'unspecified', data: process.argv[4] || 'development read-only fixture',
  commit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.resolve(__dirname, '..') }).trim(),
  nativeBuild: 'Android debug; generated before JS version 1.6.59 bump',
  capturedAt: new Date().toISOString(), source: 'adb exec-out screencap -p', iosEvidence: false,
};
fs.writeFileSync(target.replace(/\.png$/, '.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ file: target, ...metadata }));
