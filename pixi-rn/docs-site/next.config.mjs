import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// GitHub Pages serves a project site (not a custom domain) under
// /<repo>/, so the exported site's root-relative asset paths need that
// prefix — but only in that one deploy target, not local dev/preview.
const basePath = process.env.GH_PAGES_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // A pure static site: no server, deployable to any static host (GitHub
  // Pages, Netlify, S3, ...) alongside the pixi-rn API reference it links to.
  output: 'export',
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
};

export default withMDX(config);
