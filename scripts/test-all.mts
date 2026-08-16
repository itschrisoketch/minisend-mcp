/**
 * Runs every test script in sequence. No test runner is installed on purpose —
 * this mirrors the convention in the minisend-merchant repo, where tests are
 * standalone assert scripts run with tsx.
 */
import { execFileSync } from 'node:child_process'

const SCRIPTS = ['scripts/test-knowledge-data.ts', 'scripts/test-server.mts']

for (const script of SCRIPTS) {
  console.log(`\n─── ${script}`)
  execFileSync('npx', ['tsx', script], { stdio: 'inherit' })
}

console.log('\nall suites passed\n')
