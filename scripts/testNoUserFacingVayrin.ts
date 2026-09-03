/** Regression guard for the retired user-facing Vayrin character name.
 *
 * The legacy codename remains in stable module names, analytics events,
 * feature flags, fixtures, persisted values, and backend contracts. Those
 * technical tokens are intentionally allowlisted below. Natural-language UI,
 * accessibility, and notification strings are not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOTS = [
  'app',
  'components',
  'lib',
  'ShareExtension.tsx',
  'index.share.js',
  'native/share-extension',
  'supabase/functions/process-share-jobs/shareCompletionNotification.ts',
];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.swift']);

type Finding = { file: string; line: number; text: string };

function sourceFiles(relativePath: string): string[] {
  const absolutePath = path.join(ROOT, relativePath);
  const stat = statSync(absolutePath);
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(path.extname(absolutePath)) ? [absolutePath] : [];
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) =>
    sourceFiles(path.join(relativePath, entry.name)),
  );
}

function isModuleSpecifier(node: ts.Node): boolean {
  return (
    (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) &&
    node.parent.moduleSpecifier === node
  );
}

function isAllowedTechnicalToken(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (value === 'VAYRIN') return false;
  if (value === 'vayrinProductUiEnabled') return true;
  if (/^(?:EXPO_PUBLIC_)?VAYRIN_[A-Z0-9_]+$/.test(value)) return true;
  return value === value.toLowerCase() && /^[a-z0-9_./:@+\-]*vayrin[a-z0-9_./:@+\-]*$/.test(value);
}

function isAllowedInternalString(file: string, node: ts.Node, value: string): boolean {
  if (isModuleSpecifier(node)) return true;
  if (isAllowedTechnicalToken(value)) return true;
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  return relative === 'lib/vayrinCandidateFixtures.ts' && value === 'Unknown Vayrin candidate fixture: ';
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function inspectTypeScript(file: string): Finding[] {
  const sourceText = readFileSync(file, 'utf8');
  const kind = /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];

  function inspect(node: ts.Node): void {
    let value: string | null = null;
    if (ts.isStringLiteralLike(node)) value = node.text;
    else if (
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail ||
      node.kind === ts.SyntaxKind.JsxText
    ) {
      value = (node as ts.TemplateLiteralLikeNode | ts.JsxText).text;
    }
    if (/vayrin/i.test(value ?? '') && !isAllowedInternalString(file, node, value!)) {
      findings.push({
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line: lineOf(source, node),
        text: value!.trim().replace(/\s+/g, ' '),
      });
    }
    ts.forEachChild(node, inspect);
  }

  inspect(source);
  return findings;
}

function inspectSwift(file: string): Finding[] {
  return readFileSync(file, 'utf8').split(/\r?\n/).flatMap((text, index) =>
    /vayrin/i.test(text)
      ? [{ file: path.relative(ROOT, file).replace(/\\/g, '/'), line: index + 1, text: text.trim() }]
      : [],
  );
}

const findings = SOURCE_ROOTS
  .flatMap(sourceFiles)
  .sort()
  .flatMap((file) => path.extname(file) === '.swift' ? inspectSwift(file) : inspectTypeScript(file));

if (findings.length > 0) {
  console.error('FAIL User-facing Vayrin branding remains:');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} ${JSON.stringify(finding.text)}`);
  }
  process.exit(1);
}

console.log('PASS no user-facing or accessibility Vayrin branding remains.');
console.log('Allowed: module paths, technical flags/contracts, analytics/fixture tokens, and one dev-only fixture error.');
