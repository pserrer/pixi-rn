# pixi-rn-docs

The documentation site for [`pixi-rn`](..) — guides, concepts and worked
examples as hand-written [Fumadocs](https://fumadocs.dev) MDX, plus
`pixi-rn`'s generated [TypeDoc](https://typedoc.org) API reference embedded
at `/api/`. A plain Next.js App Router shell around the content, statically
exported (`output: 'export'`) — the built site is static HTML/CSS/JS with no
server, deployable to any static host.

It lives inside `packages/pixi-rn` (not beside it as a sibling package) on
purpose: this repo mirrors `packages/pixi-rn` alone into a separate public
repo, and nesting the docs site here means that mirror carries the whole
docs site with it instead of leaving it behind.

## Develop

```sh
npm run docs:site:dev   # from the repo root — starts `next dev` with live reload
```

Content lives under `content/docs/`, one `.mdx` file per page plus a
`meta.json` per folder for sidebar title/ordering. `/api/` isn't served in
dev mode (only `public/` files are, and it's populated by the build step) —
run `npm run docs --workspace=pixi-rn` once if you need to check a link into
it locally.

## Build

```sh
npm run docs:site       # from the repo root
```

Runs, in order: `pixi-rn`'s TypeDoc build (via this package's `prebuild`
script, `scripts/copy-api-docs.mjs` — regenerating it first if
`packages/pixi-rn/docs/` doesn't exist yet), copies that output into
`public/api/`, then `next build`. Output lands in `out/`.

```sh
npx serve out            # from packages/pixi-rn/docs-site, after building
```

`out/` is a plain static site — open `out/index.html` through an actual HTTP
server (not `file://`; Next's own asset paths are absolute) or deploy the
whole folder to GitHub Pages, Netlify, S3, or anywhere else that serves
static files.

## Adding a page

1. Add a `.mdx` file under `content/docs/` (or a subfolder) with `title` and
   `description` frontmatter.
2. Add its filename (no extension) to the relevant `meta.json`'s `pages`
   array, in the order it should appear in the sidebar.

Nothing else needs wiring — the route (`app/docs/[[...slug]]/page.tsx`) and
the sidebar tree (`lib/source.ts`) both resolve from `content/docs/` at
build time.
