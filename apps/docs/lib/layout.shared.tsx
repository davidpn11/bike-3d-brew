import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, demoUrl, repoUrl } from './site';

/** `docs`: the sidebar already lists Progress and How to test, so only add the demo there. */
export function baseOptions({ docs = false } = {}): BaseLayoutProps {
  const demo = { text: 'Live demo', url: demoUrl, external: true };
  return {
    nav: { title: appName },
    githubUrl: repoUrl,
    links: docs
      ? [demo]
      : [
          { text: 'Progress', url: '/docs/progress/' },
          { text: 'How to test', url: '/docs/testing-guide/' },
          { text: 'Docs', url: '/docs/' },
          demo,
        ],
  };
}
