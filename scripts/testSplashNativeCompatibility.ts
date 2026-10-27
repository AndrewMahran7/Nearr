import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual pinned dependency, mocking only its native boundary.
async function main() {
  const source = readFileSync('node_modules/expo-splash-screen/src/index.native.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const kind of ['promise', 'void', 'throw', 'reject', 'missing'] as const) {
    const nativeError = new Error('native teardown');
    let forwarded: unknown;
    let handler: ((error: Error, fatal: boolean) => void) | undefined;
    const module = { exports: {} as any };
    vm.runInNewContext(code, {
      exports: module.exports, module,
      require: () => ({ requireOptionalNativeModule: () => kind === 'missing' ? null : {
        preventAutoHideAsync: () => Promise.resolve(true),
        hideAsync: () => {
          if (kind === 'throw') throw nativeError;
          if (kind === 'reject') return Promise.reject(nativeError);
          return kind === 'void' ? undefined : Promise.resolve(true);
        },
      } }),
      ErrorUtils: {
        getGlobalHandler: () => (error: Error) => { forwarded = error; },
        setGlobalHandler: (next: typeof handler) => { handler = next; },
      },
    });
    const api = module.exports;
    await api.preventAutoHideAsync();
    if (kind === 'throw' || kind === 'reject') await assert.rejects(api.hideAsync(), /native teardown/);
    else await api.hideAsync();
    if (kind !== 'missing') {
      const original = new Error('original application error');
      assert.doesNotThrow(() => handler!(original, true));
      assert.equal(forwarded, original, 'splash failure must not mask the original fatal error');
      await new Promise(resolve => setImmediate(resolve));
    }
    console.log(`PASS splash native compatibility: ${kind}`);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
