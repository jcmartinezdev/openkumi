// Builds the app's own two programs: the one behind the window, and the small one that runs
// inside the window before its page (which has to be a single file).
import { build } from 'esbuild'

await build({
  entryPoints: { main: 'src/main.ts', preload: 'src/preload.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  logLevel: 'info',
})
