// Push Held's testnet role keys + admin token to Vercel env (production + preview) without printing them.
// Keys come from .state/merchant.json (gitignored). The admin token is generated once and kept in .state/admin-token.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const root = new URL('../', import.meta.url).pathname
const st = JSON.parse(readFileSync(root + '.state/merchant.json', 'utf8'))
const tokFile = root + '.state/admin-token'
if (!existsSync(tokFile)) writeFileSync(tokFile, randomBytes(18).toString('base64url'))
const vars = { MERCHANT_KEY: st.merchantKey, RESOLVER_KEY: st.resolverKey, HELD_ADMIN_TOKEN: readFileSync(tokFile, 'utf8').trim() }
const bin = root + 'node_modules/.bin/vercel'
for (const env of ['production', 'preview']) {
  for (const [k, v] of Object.entries(vars)) {
    spawnSync(bin, ['env', 'rm', k, env, '--yes'], { cwd: root, stdio: 'ignore' })
    const r = spawnSync(bin, ['env', 'add', k, env], { cwd: root, input: v, encoding: 'utf8' })
    console.log(`${env} ${k}: ${r.status === 0 ? 'set' : 'FAILED ' + (r.stderr || '').split('\n').slice(-3).join(' ')}`)
  }
}
