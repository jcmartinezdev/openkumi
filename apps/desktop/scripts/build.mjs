// Builds the app's own programs: the one behind the window, the small one that runs inside the
// window before its page (which has to be a single file), and, on a Mac, the one that takes
// dictation (packages/dictation), which is Swift.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
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

if (process.platform === 'darwin') {
  const dictation = path.resolve(import.meta.dirname, '..', '..', '..', 'packages', 'dictation')
  const sources = [path.join(dictation, 'apple', 'Dictation.swift'), path.join(dictation, 'macos', 'main.swift')]
  const out = path.resolve(import.meta.dirname, '..', 'dist', 'dictation')
  const built = fs.existsSync(out) ? fs.statSync(out).mtimeMs : 0
  if (sources.some((source) => fs.statSync(source).mtimeMs > built)) {
    try {
      // It runs on any Mac the app does, with either kind of processor, and says for itself
      // whether that Mac can take dictation (macOS 26 or later).
      const parts = ['arm64', 'x86_64'].map((arch) => {
        const part = `${out}.${arch}`
        execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-parse-as-library', '-target', `${arch}-apple-macos12`, ...sources, '-o', part], { stdio: 'inherit' })
        return part
      })
      execFileSync('xcrun', ['lipo', '-create', ...parts, '-output', out], { stdio: 'inherit' })
      parts.forEach((part) => fs.rmSync(part))
      console.log('  dist/dictation')
    } catch (e) {
      // A release must not go out without it for want of a compiler on the computer that made it.
      if (process.env.OPENKUMI_REQUIRE_DICTATION) throw e
      // Otherwise the app works without it; there is just no microphone button.
      console.warn('Dictation was not built: it needs Xcode or its command line tools (xcode-select --install).')
    }
  }
}
