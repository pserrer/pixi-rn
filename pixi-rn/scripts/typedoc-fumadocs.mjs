// A local TypeDoc plugin (loaded via typedoc.json's "plugin" array) that
// makes typedoc-plugin-markdown's output consumable as native Fumadocs
// pages: every page needs Fumadocs' frontmatter (title, description) rather
// than typedoc-plugin-markdown's default bare-H1 pages.
import { MarkdownPageEvent } from 'typedoc-plugin-markdown';

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.BEGIN, (page) => {
    if (!page.model?.name) return;
    const summary = page.model.comment?.summary ?? page.model.signatures?.[0]?.comment?.summary;
    // Source doc comments soft-wrap for readability; collapse those single
    // newlines to spaces so the description doesn't truncate mid-sentence,
    // but keep paragraph breaks (blank lines) as the actual cutoff.
    const text = summary
      ?.map((part) => part.text)
      .join('')
      .split(/\n{2,}/)[0]
      ?.replace(/\n/g, ' ');
    page.frontmatter = {
      title: page.model.name,
      description: text,
      ...page.frontmatter,
    };
  });
}
