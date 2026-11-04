// Publish the source of every registered merchant's HeldArbiter on Tempo's explorer (batch; new shops are verified
// automatically when they register, see server/verify-contract.ts). Read-only on the database; safe to re-run: it skips
// contracts that are already verified, so it also catches any registration whose verification didn't go through.
//   DATABASE_URL=... HELD_NETWORK=testnet node scripts/verify-arbiters.ts [--dry]
// Older shops can still run an older contract version (v2/v3): each is verified with the exact source of its version,
// taken from git (same compiler and settings in every version).
import { execFileSync } from 'node:child_process'
import type { Address } from 'viem'
import { network, pub } from './lib.ts'
import { pgAdapter } from '../server/pgdb.ts'
import { VERIFIER, isVerified } from '../server/verify-contract.ts'
import input from '../shared/HeldArbiter.verify.json' with { type: 'json' }

// The commits whose contracts/HeldArbiter.sol was deployed for each VERSION (v3 changed once while staying v3).
const SOURCES: Record<string, (string | null)[]> = { '2': ['b15a8f8'], '3': ['608ba4c', 'bf4b806'], '4': [null] } // null = current

const dry = process.argv.includes('--dry')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const pg = pgAdapter(process.env.DATABASE_URL, `held_${network.name}`)
const db = await pg.read()
await pg.end()
if (!db) throw new Error(`no data in held_${network.name}`)

const chainId = pub.chain!.id
const current = Object.values(db.merchants).map((m) => m.arbiter.toLowerCase() as Address)
const older = Object.values(db.merchants).flatMap((m) => (m.previousArbiters ?? []).map((p) => p.arbiter.toLowerCase() as Address))
const all = [...new Set([...current, ...older])]
console.log(`${network.name} (chain ${chainId}): ${current.length} shops, ${all.length} arbiters (${all.length - current.length} older)`)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const versionAbi = [{ type: 'function', name: 'VERSION', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const
const sourceAt = (commit: string | null) => commit === null ? input.stdJsonInput.sources['HeldArbiter.sol'].content
  : execFileSync('git', ['show', `${commit}:contracts/HeldArbiter.sol`], { encoding: 'utf8' })

// One verification attempt; retries while the verifier is out of capacity (it says so in its error).
async function verify(address: Address, content: string): Promise<string> {
  const body = JSON.stringify({ ...input, stdJsonInput: { ...input.stdJsonInput, sources: { 'HeldArbiter.sol': { content } } } })
  for (let attempt = 1; attempt <= 8; attempt++) {
    const sub = await fetch(`${VERIFIER}/v2/verify/${chainId}/${address}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then((r) => r.json()) as { verificationId?: string, customCode?: string, message?: string }
    if (sub.customCode === 'already_verified') return 'already verified'
    if (!sub.verificationId) return `not submitted: ${sub.customCode ?? ''} ${sub.message ?? ''}`.trim()
    let job: { isJobCompleted?: boolean, contract?: { match?: string } | null, error?: { message?: string } } = {}
    for (let i = 0; i < 30 && !job.isJobCompleted; i++) {
      await sleep(3000)
      job = await fetch(`${VERIFIER}/v2/verify/${sub.verificationId}`).then((r) => r.json())
    }
    if (job.contract?.match) return `verified (${job.contract.match})`
    const err = job.error?.message ?? (job.isJobCompleted ? 'no match' : 'still running')
    if (!/Container instance|capacity|provisioning/i.test(err)) return `no match: ${err.split('\n')[0]}`
    console.log(`  ${address}: verifier busy, retrying in ${attempt * 30} s`)
    await sleep(attempt * 30000)
  }
  return 'no match: verifier busy, try again later'
}

const tally: Record<string, number> = {}
for (const a of all) {
  const kind = current.includes(a) ? 'current' : 'older'
  const version = String(await pub.readContract({ address: a, abi: versionAbi, functionName: 'VERSION' }).catch(() => '?'))
  let outcome: string
  if (await isVerified(chainId, a)) outcome = 'already verified'
  else if (!SOURCES[version]) outcome = `no source for VERSION ${version}`
  else if (dry) outcome = 'would submit'
  else {
    outcome = 'no match'
    for (const commit of SOURCES[version]) {
      outcome = await verify(a, sourceAt(commit))
      if (!outcome.startsWith('no match: Bytecodes')) break // matched, or a reason another source won't fix
    }
  }
  const key = outcome.replace(/[:(].*/, '').trim()
  tally[key] = (tally[key] ?? 0) + 1
  console.log(`${a}  v${version}  ${kind.padEnd(7)}  ${outcome}`)
}
console.log('summary:', tally)
