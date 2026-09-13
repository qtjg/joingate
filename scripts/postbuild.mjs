import { writeFileSync, mkdirSync } from 'node:fs'

// tsc emits plain .js for the CommonJS build; this marker tells Node that
// everything inside dist/cjs is CJS even though the package root is ESM.
mkdirSync('dist/cjs', { recursive: true })
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
console.log('dist/cjs/package.json written (type=commonjs)')
