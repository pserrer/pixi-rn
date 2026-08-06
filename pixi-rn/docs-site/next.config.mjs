import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // A pure static site: no server, deployable to any static host (GitHub
  // Pages, Netlify, S3, ...) alongside the pixi-rn API reference it links to.
  output: 'export',
  images: { unoptimized: true },
};

export default withMDX(config);
