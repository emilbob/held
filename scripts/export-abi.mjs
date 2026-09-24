// Writes server/arbiter-abi.json (ABI only, committed) from the solc build, so the API doesn't need out/ at runtime.
import { readFileSync, writeFileSync } from 'node:fs'
const { abi } = JSON.parse(readFileSync(new URL('../out/HeldArbiter.json', import.meta.url), 'utf8'))
writeFileSync(new URL('../server/arbiter-abi.json', import.meta.url), JSON.stringify(abi, null, 1) + '\n')
console.log('server/arbiter-abi.json:', abi.length, 'entries')
