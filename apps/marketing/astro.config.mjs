import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://openkumi.ai',
  trailingSlash: 'never',
  // A page is a file of its own (about.astro: about.html), and one in a folder of its own
  // (privacy/index.astro) becomes that folder's index.html, which Vercel serves at /privacy.
  build: { format: 'preserve' },
  server: { port: Number(process.env.PORT ?? 4321) },
})
