import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://openkumi.ai',
  trailingSlash: 'never',
  build: { format: 'file' },
  server: { port: Number(process.env.PORT ?? 4321) },
})
