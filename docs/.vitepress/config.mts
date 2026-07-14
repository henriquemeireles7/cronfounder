import { defineConfig } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'

export default defineConfig({
  title: 'cronfounder',
  description:
    'a company harness: the structured environment an agent mounts to run and grow a business. sensors write reality, a journal remembers, gates protect your principal.',
  // project-pages subpath; the landing page owns '/cronfounder/'
  base: '/cronfounder/docs/',
  cleanUrls: true,
  appearance: 'dark',
  // emits llms.txt + llms-full.txt + a raw .md twin of every page into the dist
  vite: { plugins: [llmstxt()] },
  themeConfig: {
    search: { provider: 'local' },
    nav: [{ text: 'home', link: 'https://henriquemeireles7.github.io/cronfounder/' }],
    // adding a page = one line in its group, e.g. { text: 'harnesses', link: '/harnesses' }
    sidebar: [
      {
        text: 'start',
        items: [
          { text: 'overview', link: '/' },
          { text: 'installation', link: '/installation' },
          { text: 'quickstart', link: '/quickstart' },
        ],
      },
      {
        text: 'understand',
        items: [
          { text: 'concepts', link: '/concepts' },
          { text: 'architecture', link: '/architecture' },
        ],
      },
      {
        text: 'operate',
        items: [
          { text: 'operating', link: '/operating' },
          { text: 'commands', link: '/commands' },
          { text: 'errors', link: '/errors' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/henriquemeireles7/cronfounder' },
    ],
    outline: { level: [2, 3] },
  },
})
