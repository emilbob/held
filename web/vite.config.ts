import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// ox 0.14.x browser mining workers attach `self.onmessage` only after their WebAssembly module loads, but the pool
// posts 'start' right after spawning. A worker that loads slowly never sees 'start', idles forever, and the search
// never finishes (on a 10-core Mac about a third of the workers lose the race). Buffer early messages and replay
// them once the handler is installed. Fails the build if ox changes this code, so the patch can't silently lapse.
function fixOxWorkerStart(): Plugin {
  const install = 'WebAssembly.instantiate(binary).then(function(result) {'
  const handlerEnd = "    mineLoop(e.data, wasm, mem, function(msg) { self.postMessage(msg) })\n  }\n"
  return {
    name: 'fix-ox-worker-start',
    transform(code, id) {
      if (!id.includes('ox/_esm/tempo/internal/virtualMasterPool')) return
      if (!code.includes(install) || !code.includes(handlerEnd)) this.error('ox worker source changed: review fixOxWorkerStart in vite.config.ts')
      return code
        .replace(install, 'var __early = []\nself.onmessage = function(e) { __early.push(e) }\n\n' + install)
        .replace(handlerEnd, handlerEnd + '  __early.splice(0).forEach(function(e) { self.onmessage(e) })\n')
    },
  }
}

export default defineConfig({
  plugins: [react(), fixOxWorkerStart()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
})
