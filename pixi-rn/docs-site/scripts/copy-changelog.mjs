// Turns pixi-rn's own CHANGELOG.md into a native Fumadocs page instead of
// leaving it as a second, hand-duplicated copy that drifts from the real
// one — same "single source of truth, generated at build time" approach as
// copy-api-docs.mjs, just for one file instead of a whole TypeDoc tree.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS_SITE_ROOT = path.resolve(HERE, '..');
const PIXI_RN_ROOT = path.resolve(DOCS_SITE_ROOT, '..');
const SOURCE = path.join(PIXI_RN_ROOT, 'CHANGELOG.md');
const DEST = path.join(DOCS_SITE_ROOT, 'content', 'docs', 'changelog.mdx');

// Fumadocs' DocsPage already renders an H1 from the frontmatter `title` —
// every other hand-written page in content/docs/ starts at `##` for the same
// reason, so strip CHANGELOG.md's own leading `# Changelog` to match instead
// of showing the title twice.
const body = readFileSync(SOURCE, 'utf8').replace(/^#\s+Changelog\s*\n+/, '');

writeFileSync(
  DEST,
  `---
title: Changelog
description: Every published pixi-rn version, and what changed in it.
---

${body}`,
);

console.log(`[copy-changelog] generated ${DEST}`);
