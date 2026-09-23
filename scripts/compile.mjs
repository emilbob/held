// Compile contracts/HeldArbiter.sol with solc-js -> out/HeldArbiter.json
import solc from 'solc'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const src = readFileSync(new URL('../contracts/HeldArbiter.sol', import.meta.url), 'utf8')
const evmVersion = process.env.EVM_VERSION || 'cancun'
const input = {
  language: 'Solidity',
  sources: { 'HeldArbiter.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errs = (out.errors || []).filter((e) => e.severity === 'error')
for (const e of out.errors || []) console.error(e.formattedMessage)
if (errs.length) process.exit(1)
const c = out.contracts['HeldArbiter.sol'].HeldArbiter
mkdirSync(new URL('../out/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../out/HeldArbiter.json', import.meta.url),
  JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, evmVersion }, null, 2),
)
console.log(`compiled HeldArbiter (${evmVersion}), bytecode ${c.evm.bytecode.object.length / 2} bytes`)
