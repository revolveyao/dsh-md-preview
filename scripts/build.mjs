/**
 * Build the browser half into the DSH plugin loader's single-file module
 * wrapper (`window.__ModuleLoader__.load({ id, factory })`).
 *
 * The loader serves exactly one file per plugin (`/plugins/<pkg>/client.js`)
 * and evaluates it as a plain script, so the bundle must be CommonJS behind
 * that wrapper — no ESM output, no code splitting, no sibling .css. `react`
 * stays external (the host owns the single React instance).
 *
 * Weight policy: markdown-exit, the Shiki core and CodeMirror are bundled;
 * mermaid is NOT — the host half serves it from this package's node_modules on
 * first diagram (`/md-preview/api/asset/mermaid`), so a document without
 * diagrams never downloads it. ColaMD's CSS is vendored as text and inlined
 * here, because a plugin may not ship a sibling stylesheet.
 *
 * The output is written atomically (temp file + rename): a running DSH fetches
 * this file from disk on page refresh, so an in-place overwrite could hand it a
 * half-written bundle.
 */
import { build } from 'esbuild'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareColamd } from './prepare-colamd.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

// The vendored ColaMD stylesheets become a module before bundling — a plugin
// cannot ship a sibling .css, so the stylesheet has to arrive inside client.js.
// This also enforces the colour contract (docs/themes.md): a theme in
// vendor/extra that skips a required variable fails the build here.
const prepared = await prepareColamd(root)
if (prepared.incomplete.length > 0) {
  console.log(`theme colour contract: ${prepared.incomplete.length} vendored theme(s) incomplete (reported, not fatal — vendored files stay byte-identical to upstream)`)
  for (const line of prepared.incomplete) console.log(`  - ${line}`)
}

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.jsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  // Automatic runtime: esbuild emits the `react/jsx-runtime` import itself, so a
  // module using JSX cannot forget `import React`. With the classic factory that
  // omission was not a build error but a render-time "React is not defined",
  // which surfaced as a button that never appeared.
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  legalComments: 'none',
  logLevel: 'warning',
})

const outputs = result.outputFiles
const entry = outputs.find((file) => /\.(js|cjs)$/.test(file.path)) ?? outputs[0]
if (entry === undefined) {
  throw new Error(`esbuild produced no output (${outputs.length} files: ${outputs.map((file) => file.path).join(', ')})`)
}
const body = entry.text
const out = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} }; var exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`

const outFile = resolve(root, 'lib/client.js')
await mkdir(dirname(outFile), { recursive: true })
const tmpFile = `${outFile}.tmp-${process.pid}`
await writeFile(tmpFile, out)
await rename(tmpFile, outFile)
console.log(`built ${outFile} (${out.length} bytes)`)
