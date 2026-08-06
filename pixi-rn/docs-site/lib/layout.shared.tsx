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
        text: 'GitHub',
        url: 'https://github.com/pserrer/game/tree/main/packages/pixi-rn',
      },
    ],
  };
}
