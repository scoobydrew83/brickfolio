import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return name.endsWith('.tsx') ? [p] : [];
  });
}

/** Components whose `title` prop is their own (a heading or a dialog's name), not the HTML tooltip attribute. */
const TITLE_PROP = new Set(['PageHeader', 'EmptyState', 'Dialog', 'Confirm', 'CommandDialog', 'CopyForm']);
/** HTML elements where `title` means something besides a tooltip (an iframe's name, an abbreviation's expansion). */
const TITLE_ELEMENT = new Set(['iframe', 'abbr']);
/** Files not converted yet, with the issue that converts them. */
const PENDING = new Set<string>([]);

describe('tooltips (#104)', () => {
  it('uses <Tip> instead of an HTML title attribute, which never shows on touch screens', () => {
    const hits: string[] = [];
    for (const file of ['app', 'components'].flatMap((d) => sources(join(root, d)))) {
      const rel = file.slice(root.length + 1);
      if (PENDING.has(rel)) continue;
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(sf);
          const title = node.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'title');
          if (title && !TITLE_PROP.has(tag) && !TITLE_ELEMENT.has(tag)) {
            hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(title.getStart(sf)).line + 1} <${tag} title=…>`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });
});
