// Publish a merchant's HeldArbiter source on Tempo's explorer: submit it to Tempo's contract verifier
// (contracts.tempo.xyz, a Sourcify-compatible API; free, no key). Then anyone can read the exact code that holds their
// payment on explore.tempo.xyz, without the GitHub repo.
// The input (shared/HeldArbiter.verify.json, written by scripts/export-abi.ts) rebuilds the genuine bytecode exactly,
// so it only verifies contracts that are the real HeldArbiter, which is the only kind the server registers.
// Best effort: it never throws, and a failure never blocks a registration (the verifier finishes on its own).
import input from '../shared/HeldArbiter.verify.json' with { type: 'json' }
import type { Address } from 'viem'

export const VERIFIER = 'https://contracts.tempo.xyz'

export type Submitted = { ok: true, verificationId?: string, already?: boolean } | { ok: false, error: string }

export async function submitVerification(chainId: number, address: Address, timeoutMs = 4000): Promise<Submitted> {
  try {
    const res = await fetch(`${VERIFIER}/v2/verify/${chainId}/${address}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await res.json().catch(() => ({})) as { verificationId?: string, customCode?: string, message?: string }
    if (res.ok && body.verificationId) return { ok: true, verificationId: body.verificationId }
    if (body.customCode === 'already_verified') return { ok: true, already: true }
    return { ok: false, error: `${res.status} ${body.customCode ?? ''} ${body.message ?? ''}`.trim() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// The verifier's result for a submission: 'exact_match' | 'match' when verified, null while running or on failure.
export async function verificationResult(verificationId: string): Promise<{ done: boolean, match: string | null, error?: string }> {
  const res = await fetch(`${VERIFIER}/v2/verify/${verificationId}`, { signal: AbortSignal.timeout(10000) })
  const b = await res.json() as { isJobCompleted?: boolean, contract?: { match?: string } | null, error?: { message?: string } }
  return { done: !!b.isJobCompleted, match: b.contract?.match ?? null, error: b.error?.message }
}

// Already verified? (one GET; true for 'exact_match' or 'match')
export async function isVerified(chainId: number, address: Address): Promise<boolean> {
  try {
    const res = await fetch(`${VERIFIER}/v2/contract/${chainId}/${address}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return false
    const b = await res.json() as { match?: string | null }
    return b.match === 'exact_match' || b.match === 'match'
  } catch { return false }
}
