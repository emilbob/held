// Writes shared/HeldArbiter.json (ABI + creation bytecode, committed) from the solc build. The server uses it to verify
// merchants' arbiters byte for byte, and the web app to deploy a merchant's arbiter from their own wallet.
import { readFileSync, writeFileSync } from 'node:fs'
const { abi, bytecode } = JSON.parse(readFileSync(new URL('../out/HeldArbiter.json', import.meta.url), 'utf8'))
writeFileSync(new URL('../shared/HeldArbiter.json', import.meta.url), JSON.stringify({ abi, bytecode }) + '\n')
console.log('shared/HeldArbiter.json:', abi.length, 'ABI entries,', (bytecode.length - 2) / 2, 'bytes of bytecode')
