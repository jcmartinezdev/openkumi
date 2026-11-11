import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.OPENBOT_DEV_PORT ?? 5173)

// The interface is built into the desktop app, which hands these files to its own window. While
// developing, the app passes its window's requests on to this server instead, so changes show at once.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'esnext' },
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    // The window's own address is not one a socket can be opened to, so live updates connect here directly.
    hmr: { protocol: 'ws', host: '127.0.0.1', clientPort: port },
  },
})
