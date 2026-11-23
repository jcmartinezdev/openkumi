import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

const GITHUB_URL = 'https://github.com/jcmartinezdev/openkumi'

export default defineConfig({
  site: 'https://docs.openkumi.ai',
  server: { port: Number(process.env.PORT ?? 4322) },
  integrations: [
    starlight({
      title: 'OpenKumi',
      description: 'How to install and set up OpenKumi, what its bots can do, how it works, and how it keeps you safe.',
      logo: { src: './src/assets/kumi.svg', alt: '' },
      favicon: '/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.png', type: 'image/png', sizes: '64x64' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://docs.openkumi.ai/social-card.png' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://docs.openkumi.ai/social-card.png' } },
      ],
      social: [{ icon: 'github', label: 'OpenKumi on GitHub', href: GITHUB_URL }],
      editLink: { baseUrl: `${GITHUB_URL}/edit/main/apps/docs/` },
      customCss: ['@fontsource-variable/inter', '@fontsource-variable/bricolage-grotesque', './src/styles/brand.css', './src/styles/diagrams.css'],
      components: { SocialIcons: './src/components/HeaderLinks.astro' },
      // The pages, in the order someone new reads them. A page is a Markdown file in src/content/docs.
      sidebar: [
        {
          label: 'Start here',
          items: [{ label: 'Welcome', slug: 'index' }, 'install', 'getting-started', 'features'],
        },
        {
          label: 'Setting up',
          items: ['setup/providers', 'setup/bots', 'environments', 'connections', 'superpowers', 'automations', 'webhooks', 'calls'],
        },
        {
          label: 'Everyday use',
          items: ['using/conversation', 'using/browser', 'using/usage'],
        },
        {
          label: 'How it works',
          items: [
            { label: 'The big picture', slug: 'how-it-works' },
            'how-it-works/a-bot',
            'how-it-works/where-everything-lives',
            'how-it-works/what-a-bot-is-told',
            'how-it-works/conversation',
            'how-it-works/queue',
            'how-it-works/subagents',
            'how-it-works/messages-between-bots',
            'how-it-works/tools',
            { label: 'Engines and models', slug: 'how-it-works/engines' },
            'how-it-works/replies-and-pages',
            'how-it-works/calls',
            { label: 'Processes and threads', slug: 'how-it-works/inside-the-app' },
          ],
        },
        {
          label: 'Security',
          items: [{ label: 'Overview', slug: 'security' }, 'security/access', 'security/bots', 'security/outside', 'security/limits', { label: 'Usage and error reports', slug: 'telemetry' }],
        },
        {
          label: 'Reference',
          items: ['settings', 'reference/cli', 'troubleshooting'],
        },
      ],
    }),
  ],
})
