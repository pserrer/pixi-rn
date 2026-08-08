// Turns pixi-rn's TypeDoc-generated markdown into native Fumadocs pages
// under content/docs/api/, so the API reference shares this site's own
// layout, theme and sidebar instead of living as a disconnected raw-HTML
// subtree (which is what public/api/ used to be, before this rewrite).
// TypeDoc (via typedoc-plugin-markdown + typedoc-plugin-frontmatter, see
// ../../typedoc.json) already emits Fumadocs-flavoured frontmatter; this
// script's own job is the two things TypeDoc can't do for a destination it
// doesn't know about: rewrite its relative `../foo/Bar.md`-style cross-links
// into absolute `/docs/api/...` routes (Fumadocs pages don't live at the
// file paths TypeDoc linked against), and add meta.json files for a nicer
// sidebar than raw folder names like "type-aliases".
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS_SITE_ROOT = path.resolve(HERE, '..');
// This site lives INSIDE packages/pixi-rn (docs-site/) rather than beside it,
// specifically so a prefix mirror of packages/pixi-rn into a separate public
// repo carries the whole docs site along with it — do not move it back out.
const PIXI_RN_ROOT = path.resolve(DOCS_SITE_ROOT, '..');
const PIXI_RN_DOCS = path.join(PIXI_RN_ROOT, 'docs');
const DEST = path.join(DOCS_SITE_ROOT, 'content', 'docs', 'api');
const BASE_ROUTE = '/docs/api';

if (!existsSync(PIXI_RN_DOCS)) {
  console.log('[copy-api-docs] pixi-rn/docs not found, generating it first…');
  execFileSync('npm', ['run', 'docs'], { cwd: PIXI_RN_ROOT, stdio: 'inherit' });
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(path.dirname(DEST), { recursive: true });
cpSync(PIXI_RN_DOCS, DEST, { recursive: true });

// typedoc-plugin-markdown's entry page is README.md; Fumadocs wants an
// index page for a folder's own landing route.
const readme = path.join(DEST, 'README.md');
if (existsSync(readme)) {
  const index = path.join(DEST, 'index.md');
  writeFileSync(index, readFileSync(readme, 'utf8'));
  rmSync(readme);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = walk(DEST);
for (const file of files) {
  const dir = path.dirname(file);
  const content = readFileSync(file, 'utf8').replace(
    /\]\(([^)\s]+?\.md)(#[^)]*)?\)/g,
    (_match, relPath, anchor = '') => {
      const targetAbs = path.resolve(dir, relPath);
      const targetRoute = path.relative(DEST, targetAbs).replace(/\.md$/, '').replace(/\\/g, '/');
      return `](${BASE_ROUTE}/${targetRoute}${anchor})`;
    },
  );
  writeFileSync(file, content);
}

writeFileSync(path.join(DEST, 'meta.json'), JSON.stringify({ title: 'API Reference' }, null, 2) + '\n');
const titleCase = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
for (const entry of readdirSync(DEST)) {
  const full = path.join(DEST, entry);
  if (statSync(full).isDirectory()) {
    writeFileSync(path.join(full, 'meta.json'), JSON.stringify({ title: titleCase(entry) }, null, 2) + '\n');
  }
}

console.log(`[copy-api-docs] generated ${files.length} Fumadocs pages at ${DEST}`);
