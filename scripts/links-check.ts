// Checkout-link rules against a Held server, signed in as the sandbox merchant (public testnet key).
// Usage: npm run test:links   (APP=https://held-lilac.vercel.app npm run test:links for the live site)
import { readFileSync } from 'node:fs'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { signInMessage } from '../shared/api.ts'
const APP = process.env.APP || 'http://localhost:8787', API = `${APP}/api`, HOST = new URL(APP).host, n = JSON.parse(readFileSync('network.json', 'utf8'))
const call = async (method: string, p: string, body?: unknown, token?: string, ip?: string) => {
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...(ip && { 'x-forwarded-for': ip }) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json() as any }
}
const signIn = async (key: `0x${string}`) => { const a = privateKeyToAccount(key); const issued = Math.floor(Date.now() / 1000)
  return (await call('POST', '/auth', { address: a.address, issued, signature: await a.signMessage({ message: signInMessage(a.address, HOST, issued) }) })).body.token as string }
const results: boolean[] = []; const check = (name: string, pass: boolean, d: unknown = '') => { results.push(pass); console.log(pass ? 'PASS' : 'FAIL', name, d) }

const tok = await signIn(n.sandbox.merchantKey), stranger = await signIn(generatePrivateKey())
check('create link without sign-in -> 401', (await call('POST', '/links', { item: 'x', amount: '5' })).status === 401)
check('non-merchant cannot create links -> 401', (await call('POST', '/links', { item: 'x', amount: '5' }, stranger)).status === 401)
check('bad price -> 400', (await call('POST', '/links', { item: 'x', amount: '-3' }, tok)).status === 400)
const L = (await call('POST', '/links', { item: 'Sandbox mug', amount: '12.50' }, tok)).body
check('merchant creates a link', typeof L.id === 'string' && L.amount === '12500000', L.id)
const pub = (await call('GET', `/links/${L.id}`)).body
check('public link view: item, price, shop name', pub.item === 'Sandbox mug' && pub.amount === '12500000' && pub.merchantName === 'Sandbox Shop')
const o1 = await call('POST', `/links/${L.id}/orders`, {}, undefined, '10.0.0.1')
const dbl = await call('POST', `/links/${L.id}/orders`, {}, undefined, '10.0.0.1')
// On Vercel x-forwarded-for is the caller's real IP (it can't be faked), so wait out the 3 s double-open guard.
await new Promise((r) => setTimeout(r, 3200))
const o2 = await call('POST', `/links/${L.id}/orders`, {}, undefined, '10.0.0.2')
check('buyer opens link -> own order at the fixed price', o1.status === 201 && o1.body.amount === '12500000' && o1.body.linkId === L.id, `#${o1.body.id}`)
check('same buyer double-opening -> no second order (429)', dbl.status === 429)
check('another buyer -> a different order and address', o2.status === 201 && o2.body.id !== o1.body.id && o2.body.address !== o1.body.address, `#${o2.body.id}`)
check('stranger cannot turn the link off -> 401', (await call('POST', `/links/${L.id}`, { active: false }, stranger)).status === 401)
check('merchant turns it off', (await call('POST', `/links/${L.id}`, { active: false }, tok)).body.active === false)
check('turned-off link makes no orders -> 410', (await call('POST', `/links/${L.id}/orders`, {}, undefined, '10.0.0.3')).status === 410)
const list = (await call('GET', '/links', undefined, tok)).body.links.find((x: any) => x.id === L.id)
check('dashboard list counts its orders', list?.orders === 2 && list?.active === false, list)
check("stranger's link list is empty of it", !(await call('GET', '/links', undefined, stranger)).body.links.some((x: any) => x.id === L.id))
check('unknown link -> 404', (await call('POST', '/links/AAAAAAAA/orders', {}, undefined, '10.0.0.4')).status === 404)
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
