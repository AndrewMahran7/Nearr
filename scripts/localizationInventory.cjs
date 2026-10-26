/* AST-based literal inventory. --apply is the one-time migration, not part of runtime. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const excluded = new Set(['app/_layout.tsx', 'app/plus.tsx', 'components/AgeEligibilityGate.tsx', 'components/AiSharePermissionPrompt.tsx']);
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : []); }
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components')), path.join(root, 'ShareExtension.tsx')].filter(f => {
  const rel = path.relative(root, f).replaceAll('\\', '/');
  return !excluded.has(rel) && !rel.startsWith('app/legal/') && !rel.startsWith('components/localization/') && !/(?:dev-qa|FieldnotesNativePreview|DevModeBanner)/.test(rel);
});
const attributeNames = new Set(['title', 'label', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'description', 'message', 'actionLabel', 'buttonTitle', 'statusText', 'bannerText', 'emptyTitle', 'emptyMessage', 'subtitle', 'text', 'confirmLabel', 'cancelLabel', 'primaryLabel', 'secondaryLabel', 'loadingText']);
const proseProperties = new Set(['title', 'subtitle', 'label', 'description', 'message', 'text', 'body', 'helper', 'emptyTitle', 'emptyMessage', 'actionLabel', 'primaryLabel', 'secondaryLabel', 'ctaLabel']);
const proper = new Set(['Nearr', 'NEARR', 'nearr', 'Instagram', 'TikTok', 'Facebook', 'YouTube', 'Google', 'Apple', 'AI', 'iOS', 'Android', 'Google Maps', 'Apple Maps', 'OpenStreetMap', 'AirDrop', 'Allpress Espresso', 'Tokyo, Japan', 'kaitpark', '@kaitpark', 'instagram.com', 'you@example.com', 'celebration', 'ready', 'not_found']);
const inventory = [];
const unchanged = [];
function meaningful(s) { return /[A-Za-z]{2}/.test(s) && !proper.has(s) && !/^(?:https?:|@\/|\/\(|#[a-fA-F0-9]{3,8}$)/.test(s); }
function decode(s) { return s.replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&mdash;/g, 'â€”').replace(/&nbsp;/g, ' '); }
function jsxText(text) {
  if (!/[\r\n]/.test(text)) return decode(text);
  return decode(text.split(/\r\n|\n|\r/).map((line, i, all) => {
    let value = line.replace(/\t/g, ' ');
    if (i !== 0) value = value.replace(/^ +/, '');
    if (i !== all.length - 1) value = value.replace(/ +$/, '');
    return value;
  }).filter(Boolean).join(' '));
}
function isDiagnostic(node, source) {
  let p = node.parent;
  while (p) {
    if (ts.isJsxElement(p)) {
      const attrs = p.openingElement.attributes.getText(source);
      if (/styles\.(?:diag|debug)|testID=["'](?:debug|qa)/i.test(attrs)) return true;
    }
    p = p.parent;
  }
  return false;
}
function functionAncestor(node) { let p = node.parent; while (p) { if (ts.isFunctionLike(p)) return p; p = p.parent; } return null; }
function displayBranch(node) {
  let child = node;
  let p = node.parent;
  while (p) {
    if (ts.isConditionalExpression(p)) { if (p.condition === child) return false; }
    else if (ts.isBinaryExpression(p)) {
      if (![ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind)) return false;
      if (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.left === child) return false;
    } else if (!ts.isParenthesizedExpression(p)) break;
    child = p; p = p.parent;
  }
  if (!p || !ts.isJsxExpression(p)) return false;
  return !ts.isJsxAttribute(p.parent) || attributeNames.has(p.parent.name.text);
}
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(root, file).replaceAll('\\', '/');
  const edits = [];
  const functions = new Set();
  function record(node, value, kind, replacement) {
    if (!meaningful(value)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    inventory.push({ file: rel, line, kind, source: value });
    edits.push({ start: node.getStart(source), end: node.getEnd(), replacement });
    const fn = functionAncestor(node);
    if (fn) functions.add(fn);
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 't') return;
    if (isDiagnostic(node, source)) return;
    if (ts.isJsxText(node)) {
      const value = jsxText(node.text);
      if (meaningful(value)) record(node, value, 'jsx', `{t(${JSON.stringify(value)})}`);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = ts.isJsxAttribute(node.parent) ? decode(node.text) : node.text;
      const p = node.parent;
      if (ts.isJsxAttribute(p) && attributeNames.has(p.name.text)) {
        record(node, value, 'attribute', `{t(${JSON.stringify(value)})}`); return;
      }
      let ui = displayBranch(node);
      if (ts.isPropertyAssignment(p) && proseProperties.has(p.name.getText(source)) && functionAncestor(p)) ui = true;
      if (ts.isCallExpression(p)) {
        const call = p.expression.getText(source);
        if (call === 'Alert.alert' && p.arguments.indexOf(node) < 2) ui = true;
        if (/^(?:set(?:Error|LoadError|ErrorMessage|Message|StatusMessage|SaveMessage|FailureMessage|Notice|Toast|ValidationError))$/.test(call)) ui = true;
      }
      if (ui) { record(node, value, 'expression', `t(${JSON.stringify(value)})`); return; }
      if (meaningful(value) && (ts.isPropertyAssignment(p) && proseProperties.has(p.name.getText(source)))) unchanged.push({ file: rel, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, source: value, reason: 'module data: localize at rendering boundary' });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (apply && edits.length) {
    // Subscribe every enclosing named component, not callbacks/event handlers.
    function components(node) {
      if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text) && node.body) {
        edits.push({ start: node.body.getStart(source) + 1, end: node.body.getStart(source) + 1, replacement: '\n  useLocale();' });
      }
      if (ts.isVariableDeclaration(node) && /^[A-Z]/.test(node.name.getText(source)) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) && ts.isBlock(node.initializer.body)) {
        const body = node.initializer.body;
        edits.push({ start: body.getStart(source) + 1, end: body.getStart(source) + 1, replacement: '\n  useLocale();' });
      }
      ts.forEachChild(node, components);
    }
    components(source);
    let updated = original;
    for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
    updated = `import { t } from '@/lib/i18n';\nimport { useLocale } from '@/hooks/useLocale';\n` + updated;
    fs.writeFileSync(file, updated);
  }
}
fs.mkdirSync(path.join(root, 'artifacts/global-release/localization'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/global-release/localization/literal-inventory.json'), JSON.stringify({ migrated: inventory, moduleDataReview: unchanged }, null, 2) + '\n');
console.log(JSON.stringify({ files: new Set(inventory.map(i => i.file)).size, occurrences: inventory.length, unique: new Set(inventory.map(i => i.source)).size, moduleDataReview: unchanged.length, apply }));
