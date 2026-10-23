// Builds the WordPress plugin download (web/public/held-pay-button.zip) from wordpress/held-pay-button/, with a fresh
// copy of web/public/button.js inside so the plugin and getheld.xyz/button.js never drift apart. Run after either changes.
import { copyFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const zip = resolve(root, 'web/public/held-pay-button.zip')
copyFileSync(resolve(root, 'web/public/button.js'), resolve(root, 'wordpress/held-pay-button/button.js'))
rmSync(zip, { force: true })
execFileSync('zip', ['-rqX', zip, 'held-pay-button', '-x', '*.DS_Store'], { cwd: resolve(root, 'wordpress'), stdio: 'inherit' })
console.log(execFileSync('unzip', ['-l', zip]).toString())
