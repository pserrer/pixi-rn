// Copies pixi-rn's TypeDoc-generated API reference into this site's
// public/api/ so `next build`'s static export ships it as a plain sub-path —
// TypeDoc owns the full type-level API surface (every export, every
// parameter), this site owns the guides/examples, and the nav just links
// between them rather than duplicating one inside the other.
import { existsSync, cpSync, mkdirSync, rmSync } from 'node:fs';
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
const DEST = path.join(DOCS_SITE_ROOT, 'public', 'api');

if (!existsSync(PIXI_RN_DOCS)) {
  console.log('[copy-api-docs] pixi-rn/docs not found, generating it first…');
  execFileSync('npm', ['run', 'docs'], { cwd: PIXI_RN_ROOT, stdio: 'inherit' });
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(path.dirname(DEST), { recursive: true });
cpSync(PIXI_RN_DOCS, DEST, { recursive: true });
console.log(`[copy-api-docs] copied ${PIXI_RN_DOCS} -> ${DEST}`);
