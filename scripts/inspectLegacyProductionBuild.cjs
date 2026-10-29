// Read-only EAS artifact inspection. Never print artifact URLs or key material.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const buildId = 'a61830e1-432d-4fec-b0e9-11ea7a69826a';
const out = path.resolve('artifacts/global-release/final-production/backend');
const privateDir = path.join(out, '.tmp/private-legacy-build');
const sha = b => createHash('sha256').update(b).digest('hex');

function zipEntries(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  assert.ok(end >= 0, 'zip_directory_missing');
  const count = buf.readUInt16LE(end + 10), entries = [];
  let pos = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50);
    const method = buf.readUInt16LE(pos + 10), compressed = buf.readUInt32LE(pos + 20), size = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28), extra = buf.readUInt16LE(pos + 30), comment = buf.readUInt16LE(pos + 32);
    const name = buf.subarray(pos + 46, pos + 46 + nameLength).toString('utf8'), local = buf.readUInt32LE(pos + 42);
    entries.push({ name, size, read() {
      assert.ok(size < 80 * 1024 * 1024, 'entry_too_large');
      assert.equal(buf.readUInt32LE(local), 0x04034b50);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressed);
      const result = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: size }) : null;
      assert.ok(result, 'unsupported_zip_method'); assert.equal(result.length, size); return result;
    } });
    pos += 46 + nameLength + extra + comment;
  }
  return entries;
}

async function main() {
  const eas = spawnSync('cmd.exe', ['/d','/s','/c',`eas build:view ${buildId} --json`], { encoding: 'utf8', windowsHide: true,
    timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, EXPO_NO_TELEMETRY: '1' } });
  if (eas.status !== 0) throw new Error('eas_read_only_build_lookup_failed');
  const build = JSON.parse(eas.stdout);
  assert.equal(build.id, buildId); assert.equal(build.appVersion, '1.4.55'); assert.equal(build.appBuildVersion, '55');
  assert.equal(build.gitCommitHash, '4e6b60e9b6e727381eeac98d8361d01423e95210');
  const artifactUrl = build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl;
  assert.ok(typeof artifactUrl === 'string' && new URL(artifactUrl).protocol === 'https:', 'artifact_url_missing');
  const response = await fetch(artifactUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'legacy-public-build-inspection.json'), JSON.stringify({
      checkedAt: new Date().toISOString(), readOnly: true, buildId, appVersion: build.appVersion,
      buildNumber: build.appBuildVersion, distribution: build.distribution, gitCommitHash: build.gitCommitHash,
      createdAt: build.createdAt, artifactFileName: path.basename(new URL(artifactUrl).pathname),
      artifactHost: new URL(artifactUrl).host, artifactHttpStatus: response.status,
      artifactAvailableFields: Object.keys(build.artifacts ?? {}), bundleInspected: false,
      cloudMutations: [], realInferenceCalls: 0, caveat: 'Artifact fetch denied; no signed bundle or credential-absence claim. No signed URL or key values recorded.'
    }, null, 2) + '\n');
    throw new Error(`artifact_download_failed_http_${response.status}`);
  }
  const chunks = []; let total = 0;
  for await (const chunk of response.body) { total += chunk.length; assert.ok(total <= 160 * 1024 * 1024, 'artifact_too_large'); chunks.push(chunk); }
  const archive = Buffer.concat(chunks), entries = zipEntries(archive);
  const bundles = entries.filter(e => /\.(jsbundle|hbc)$/.test(e.name));
  assert.ok(bundles.length > 0, 'no_js_bundle');
  const bundleFindings = [];
  mkdirSync(privateDir, { recursive: true });
  if (process.platform === 'win32') {
    const who = spawnSync('whoami.exe', ['/user','/fo','csv','/nh'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const sid = who.stdout?.match(/S-1-5-[0-9-]+/)?.[0]; assert.ok(sid, 'private_directory_identity_missing');
    const acl = spawnSync('icacls.exe', [privateDir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(acl.status, 0, 'private_directory_acl_failed');
  }
  for (const [i, entry] of bundles.entries()) {
    const bytes = entry.read(), text = bytes.toString('utf8');
    const googleKeyCount = new Set(text.match(/AIza[0-9A-Za-z_-]{35}/g) ?? []).size;
    const tempPath = path.join(privateDir, `bundle-${i}.hbc`);
    writeFileSync(tempPath, bytes, { flag: 'wx' });
    const disassembly = spawnSync(path.resolve('node_modules/react-native/sdks/hermesc/win64-bin/hermesc.exe'),
      ['-dump-bytecode', tempPath], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 80 * 1024 * 1024 });
    // Raw dump remains private; never output it, because string tables may contain app keys.
    const dump = disassembly.status === 0 ? disassembly.stdout : '';
    if (dump) writeFileSync(path.join(privateDir, `bundle-${i}.bytecode.txt`), dump, { flag: 'wx' });
    bundleFindings.push({ name: entry.name, size: bytes.length, sha256: sha(bytes),
      containsGeminiEnvIdentifier: text.includes('GEMINI_API_KEY'), containsGeminiEndpoint: text.includes('generativelanguage.googleapis.com'),
      containsLegacyDirectProviderDiagnostic: text.includes('calling Gemini for sourceType'),
      distinctGoogleFormatKeyCount: googleKeyCount,
      disassemblySucceeded: disassembly.status === 0,
      disassemblyErrorKind: disassembly.status === 0 ? null : /version/i.test(disassembly.stderr ?? '') ? 'bytecode_version_mismatch' : 'disassembler_rejected',
    });
  }
  const receipt = { checkedAt: new Date().toISOString(), readOnly: true, buildId, appVersion: build.appVersion,
    buildNumber: build.appBuildVersion, distribution: build.distribution, gitCommitHash: build.gitCommitHash,
    createdAt: build.createdAt, artifactFileName: path.basename(new URL(artifactUrl).pathname), archiveSize: archive.length,
    archiveSha256: sha(archive), archiveEntryCount: entries.length, bundles: bundleFindings,
    cloudMutations: [], realInferenceCalls: 0,
    caveat: 'No credential values or signed artifact URL recorded. Counts alone do not establish key purpose or all runtime/OTA paths. Private local bundle inspection only.' };
  writeFileSync(path.join(out, 'legacy-public-build-inspection.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}
main().catch(error => { console.error(error?.code === 'ETIMEDOUT' ? 'inspection_timed_out' : error.message); process.exitCode = 1; });
