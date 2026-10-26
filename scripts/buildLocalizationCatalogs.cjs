const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const locales = ['en-US', 'es-MX', 'es-ES', 'pt-BR', 'fr', 'de', 'it', 'ja', 'ko', 'zh-Hans'];
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.[tj]sx?$/.test(e.name) ? [path.join(dir, e.name)] : []); }
const english = {};
const inventory = [];
for (const dir of ['app', 'components', 'lib', 'hooks']) {
  for (const file of walk(path.join(root, dir))) scan(file);
}
scan(path.join(root, 'ShareExtension.tsx'));
// These keys are owned static UI data and are translated explicitly at their render boundary.
const previousInventory = path.join(root, 'artifacts/global-release/localization/literal-inventory.json');
if (fs.existsSync(previousInventory)) {
  for (const item of JSON.parse(fs.readFileSync(previousInventory, 'utf8')).moduleDataReview || []) english[item.source] = item.source;
}
for (const region of Object.values(JSON.parse(fs.readFileSync(path.join(root, 'config/global-eligibility-policy.json'), 'utf8')).regions)) english[region.name] = region.name;
const permissionSource = ts.createSourceFile('permission.tsx', fs.readFileSync(path.join(root, 'components/AiSharePermissionPrompt.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function notice(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(permissionSource) === 'AI_SHARE_PERMISSION_NOTICE' && node.initializer && ts.isStringLiteralLike(node.initializer)) english[node.initializer.text] = node.initializer.text;
  ts.forEachChild(node, notice);
}
notice(permissionSource);
const notificationKeys = new Set();
for (const relative of ['supabase/functions/process-share-jobs/shareCompletionNotification.ts', 'lib/shareFailurePresentation.ts', 'lib/notifications.ts']) {
  const file = path.join(root, relative);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function collect(node) {
    if (ts.isCallExpression(node) && ['t', 'translateNotification'].includes(node.expression.getText(source))) {
      const key = node.arguments[node.expression.getText(source) === 't' ? 0 : 1];
      if (key && ts.isStringLiteralLike(key)) { english[key.text] = key.text; notificationKeys.add(key.text); }
    }
    if (relative.includes('shareCompletionNotification') && ts.isPropertyAssignment(node) && ['title', 'body'].includes(node.name.getText(source))) {
      function copy(value) {
        if (ts.isStringLiteralLike(value)) { english[value.text] = value.text; notificationKeys.add(value.text); }
        else if (ts.isTemplateExpression(value)) {
          let key = value.head.text; value.templateSpans.forEach((span, i) => { key += `{{p${i}}}` + span.literal.text; });
          english[key] = key; notificationKeys.add(key);
        } else if (ts.isConditionalExpression(value)) { copy(value.whenTrue); copy(value.whenFalse); }
      }
      copy(node.initializer);
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
}
function scan(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isCallExpression(node) && ['t', 'i18n.t'].includes(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const key = node.arguments[0].text;
      english[key] = key;
      inventory.push({ file: path.relative(root, file).replaceAll('\\', '/'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, key });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const directory = path.join(root, 'locales');
fs.mkdirSync(directory, { recursive: true });
const drafts = fs.existsSync(path.join(directory, 'drafts')) ? fs.readdirSync(path.join(directory, 'drafts')).filter(f => f.endsWith('.json')).map(file => JSON.parse(fs.readFileSync(path.join(directory, 'drafts', file), 'utf8'))) : [];
const tableLocales = ['es-MX', 'pt-BR', 'fr', 'de', 'it', 'ja', 'ko', 'zh-Hans'];
const tables = {};
for (const locale of locales) tables[locale] = {};
for (const name of fs.existsSync(path.join(directory, 'source')) ? fs.readdirSync(path.join(directory, 'source')).filter(f => f.endsWith('.tsv')) : []) {
  for (const row of fs.readFileSync(path.join(directory, 'source', name), 'utf8').split(/\r?\n/).filter(Boolean)) {
    const cells = row.split('\t');
    if (name.endsWith('.latin.tsv')) {
      if (cells.length !== 3) throw new Error(`${name}: expected 3 columns: ${cells[0]}`);
      if (cells[1]) tables['es-MX'][cells[0]] = tables['es-ES'][cells[0]] = cells[1];
      if (cells[2]) tables['pt-BR'][cells[0]] = cells[2];
      english[cells[0]] = cells[0];
      continue;
    }
    if (cells.length !== 9) throw new Error(`${name}: expected 9 columns, got ${cells.length}: ${cells[0]}`);
    tableLocales.forEach((locale, i) => { if (cells[i + 1]) tables[locale][cells[0]] = cells[i + 1]; });
    if (cells[1]) tables['es-ES'][cells[0]] = cells[1];
    english[cells[0]] = cells[0];
  }
}
for (const locale of locales) {
  const file = path.join(directory, `${locale}.json`);
  let catalog = locale === 'en-US' ? english : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  Object.assign(catalog, tables[locale]);
  for (const draft of drafts) Object.assign(catalog, draft[locale] || {});
  catalog = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
}
fs.writeFileSync(path.join(directory, 'index.ts'), locales.map((l, i) => `import locale${i} from './${l}.json';`).join('\n') + '\n\nexport const resources = {\n' + locales.map((l, i) => `  '${l}': { translation: locale${i} },`).join('\n') + '\n};\n');
const notificationCatalog = {};
for (const locale of locales) {
  const catalog = JSON.parse(fs.readFileSync(path.join(directory, `${locale}.json`), 'utf8'));
  notificationCatalog[locale] = Object.fromEntries(Object.entries(catalog).filter(([key]) => notificationKeys.has(key) || /_(zero|one|two|few|many|other)$/.test(key) && notificationKeys.has(key.replace(/_(zero|one|two|few|many|other)$/, ''))));
}
fs.writeFileSync(path.join(directory, 'notificationCatalog.ts'), '// Generated from the app locale catalogs by buildLocalizationCatalogs.cjs. Do not edit.\nexport const notificationCatalog = ' + JSON.stringify(notificationCatalog, null, 2) + ' as const;\n');
fs.mkdirSync(path.join(root, 'artifacts/global-release/localization'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/global-release/localization/key-usage.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(`${Object.keys(english).length} English keys, ${inventory.length} explicit call sites.`);
