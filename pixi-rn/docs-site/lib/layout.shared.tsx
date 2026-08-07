import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'pixi-rn',
    },
    links: [
      {
        text: 'API Reference',
        url: '/api/',
      },
      {
        text: 'npm',
        url: 'https://www.npmjs.com/package/pixi-rn',
      },
      {
        text: 'GitHub',
        url: 'https://github.com/pserrer/pixi-rn',
      },
    ],
  };
}
