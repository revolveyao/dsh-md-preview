/**
 * Checks that catch the two failures this plugin can ship silently:
 * a containment bug in the host's path resolution (it hands out file
 * contents), and a client bundle that violates the loader's single-file
 * contract (it would fail to load, or load something enormous).
 *
 * Run with `npm test`; it needs `npm run build` to have produced lib/client.js.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PreviewError,
  isMarkdownFile,
  isWithin,
  listDirectory,
  readTextFile,
  resolveReadable,
  resolveWritable,
  statFiles,
  writeTextFile,
} from '../src/host/paths.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push([true, name])
  } catch (error) {
    results.push([false, `${name} — ${error.message}`])
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'mdp-smoke-'))
const workspace = join(scratch, 'workspace')
const skills = join(scratch, 'skills')
const outside = join(scratch, 'outside')
await mkdir(join(workspace, 'docs'), { recursive: true })
await mkdir(join(workspace, 'empty'), { recursive: true })
// Dot-directories are part of the tree: this is where a workspace keeps the
// markdown people actually want to read.
await mkdir(join(workspace, '.workbuddy', 'memory'), { recursive: true })
await mkdir(join(workspace, '.deepseek-harness'), { recursive: true })
await mkdir(join(workspace, '.empty-hidden'), { recursive: true })
await mkdir(join(workspace, '.git'), { recursive: true })
await mkdir(join(workspace, 'node_modules', 'pkg'), { recursive: true })
await mkdir(join(skills, 'demo'), { recursive: true })
await mkdir(outside, { recursive: true })
await writeFile(join(workspace, 'readme.md'), '# hello\n')
await writeFile(join(workspace, 'notes.txt'), 'not markdown\n')
await writeFile(join(workspace, 'docs', 'guide.md'), 'body\n')
await writeFile(join(workspace, '.workbuddy', 'memory', 'notes.md'), 'note\n')
await writeFile(join(workspace, '.deepseek-harness', 'MEMORY.md'), 'memory\n')
await writeFile(join(workspace, '.git', 'config.md'), 'not really markdown\n')
await writeFile(join(workspace, 'node_modules', 'pkg', 'readme.md'), 'vendored\n')
await writeFile(join(skills, 'demo', 'SKILL.md'), '# skill\n')
await writeFile(join(outside, 'secret.md'), 'secret\n')

const roots = [
  { id: 'workspace', label: '工作区', path: workspace, writable: true },
  { id: 'user-dsh', label: '用户 skills', path: skills, writable: false },
]

await check('isWithin accepts a root and its descendants', () => {
  assert.equal(isWithin(workspace, workspace), true)
  assert.equal(isWithin(workspace, join(workspace, 'docs', 'guide.md')), true)
})

await check('isWithin rejects siblings and path-prefix lookalikes', () => {
  assert.equal(isWithin(workspace, outside), false)
  assert.equal(isWithin(join(scratch, 'work'), join(scratch, 'workspace-other', 'x.md')), false)
})

await check('only markdown extensions are previewable', () => {
  assert.equal(isMarkdownFile('a.md'), true)
  assert.equal(isMarkdownFile('a.MARKDOWN'), true)
  assert.equal(isMarkdownFile('a.txt'), false)
})

await check('resolveReadable resolves inside either root', async () => {
  const first = await resolveReadable(roots, 'readme.md')
  assert.equal(first.path, join(workspace, 'readme.md'))
  const second = await resolveReadable(roots, join(skills, 'demo', 'SKILL.md'))
  assert.equal(second.root.id, 'user-dsh')
})

await check('resolveReadable refuses a path outside every root', async () => {
  await assert.rejects(
    () => resolveReadable(roots, join(outside, 'secret.md')),
    (error) => error instanceof PreviewError && error.code === 'forbidden',
  )
})

await check('resolveWritable refuses a read-only root and non-markdown targets', async () => {
  await assert.rejects(
    () => resolveWritable(roots[1], join(skills, 'demo', 'SKILL.md')),
    (error) => error instanceof PreviewError && error.code === 'read-only',
  )
  await assert.rejects(
    () => resolveWritable(roots[0], join(workspace, 'notes.txt')),
    (error) => error instanceof PreviewError && error.code === 'unsupported-type',
  )
})

await check('resolveWritable refuses traversal out of the workspace', async () => {
  await assert.rejects(
    () => resolveWritable(roots[0], join(workspace, '..', 'outside', 'secret.md')),
    (error) => error instanceof PreviewError && error.code === 'forbidden',
  )
})

await check('listDirectory lists markdown files and only md-bearing directories', async () => {
  const listing = await listDirectory(workspace, { workspaceRoot: workspace })
  const names = listing.entries.map((entry) => entry.name)
  const sorted = [...names].sort()
  assert.deepEqual(
    sorted,
    ['.deepseek-harness', '.workbuddy', 'docs', 'readme.md'].sort(),
    `unexpected tree: ${JSON.stringify(names)}`,
  )
  assert.equal(listing.writable, true)
  // Dot-directories come through (that is where .deepseek-harness/MEMORY.md and
  // .workbuddy/memory live), but the heavy ones named in SKIP_DIRS still do not,
  // and a dot-directory without markdown is still left out.
  for (const kept of ['.deepseek-harness', '.workbuddy']) {
    assert.ok(names.includes(kept), `${kept} is missing from the tree`)
  }
  for (const skipped of ['.git', 'node_modules', '.empty-hidden']) {
    assert.ok(!names.includes(skipped), `${skipped} should stay out of the tree`)
  }
  const readOnly = await listDirectory(skills, { workspaceRoot: workspace })
  assert.equal(readOnly.writable, false)
})

await check('listDirectory treats a missing root as an empty level', async () => {
  const listing = await listDirectory(join(scratch, 'nope'), { workspaceRoot: workspace })
  assert.deepEqual(listing.entries, [])
})

await check('readTextFile reports the version the text was read at', async () => {
  const file = await readTextFile(join(workspace, 'readme.md'))
  assert.equal(file.text, '# hello\n')
  assert.equal(typeof file.mtimeMs, 'number')
})

await check('writeTextFile refuses a stale version instead of overwriting', async () => {
  const target = join(workspace, 'readme.md')
  const file = await readTextFile(target)
  await writeFile(target, '# changed by someone else\n')
  await assert.rejects(
    () => writeTextFile(target, '# mine\n', file.mtimeMs),
    (error) => error instanceof PreviewError && error.code === 'conflict',
  )
  assert.equal(await readFile(target, 'utf8'), '# changed by someone else\n')
})

await check('writeTextFile saves and reports the new version', async () => {
  const target = join(workspace, 'readme.md')
  const before = await readTextFile(target)
  const saved = await writeTextFile(target, '# saved\n', before.mtimeMs)
  assert.equal(await readFile(target, 'utf8'), '# saved\n')
  assert.equal(typeof saved.mtimeMs, 'number')
})

await check('writeTextFile force-writes without a version', async () => {
  const target = join(workspace, 'readme.md')
  await writeFile(target, '# external\n')
  await writeTextFile(target, '# forced\n', undefined)
  assert.equal(await readFile(target, 'utf8'), '# forced\n')
})

await check('statFiles reports files, directories and absence', async () => {
  const entries = await statFiles([
    join(workspace, 'readme.md'),
    join(workspace, 'docs'),
    join(workspace, 'gone.md'),
  ])
  assert.equal(entries[0].exists, true)
  assert.equal(entries[0].directory, false)
  assert.equal(typeof entries[0].mtimeMs, 'number')
  assert.equal(entries[1].exists, true)
  assert.equal(entries[1].directory, true)
  assert.deepEqual(entries[2], { path: join(workspace, 'gone.md'), exists: false })
})

// --- host plugin loading and route fencing ---------------------------------

let route
const effect = (fn) => { fn() }

/**
 * A context that behaves like cordis about declared services: reading an
 * undeclared service property throws instead of returning undefined. Without
 * this a plugin can pass every test and still fail to load in the real host
 * ("cannot get property … without inject").
 */
function cordisLikeContext(services, declared) {
  const context = { effect, get: (name) => services[name] }
  for (const name of Object.keys(services)) {
    Object.defineProperty(context, name, {
      enumerable: true,
      get: () => {
        if (!declared.includes(name)) throw new Error(`cannot get property "${name}" without inject`)
        return services[name]
      },
    })
  }
  return context
}

await check('the host half declares every service it reads', async () => {
  const host = await import('../src/host/index.js')
  assert.ok(Array.isArray(host.inject), 'the host half declares no inject list')
  assert.ok(host.inject.includes('webServer'), 'webServer is read but not declared')
})

await check('the host half registers its route when the context boots', async () => {
  const registered = []
  const webServer = { register: (options) => { registered.push(options); return () => {} } }
  const host = await import('../src/host/index.js')
  host.apply(cordisLikeContext({ webServer, webRuntime: { trustedHosts: [] } }, host.inject))
  assert.equal(registered.length, 1, 'the route was not registered')
  route = registered[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/md-preview/api')
  assert.equal(typeof route.handler, 'function')
})

/** Minimal request double: enough for the route's fence and JSON body read. */
function fakeRequest({ method = 'POST', url = '/md-preview/api/roots', headers = {}, body = '' } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield Buffer.from(body)
    },
  }
}

function fakeResponse() {
  const state = { status: 0, body: '' }
  return {
    state,
    writeHead(status) { state.status = status },
    end(chunk) { state.body = chunk === undefined ? '' : String(chunk) },
  }
}

await check('a request without a Host header is refused', async () => {
  const response = fakeResponse()
  await route.handler(fakeRequest(), response)
  assert.equal(response.state.status, 403)
  assert.match(response.state.body, /forbidden/)
})

await check('a cross-site request is refused', async () => {
  const response = fakeResponse()
  await route.handler(fakeRequest({ headers: { host: '127.0.0.1:43120', 'sec-fetch-site': 'cross-site' } }), response)
  assert.equal(response.state.status, 403)
})

await check('an unknown API method answers not-found, not a crash', async () => {
  const response = fakeResponse()
  await route.handler(fakeRequest({
    url: '/md-preview/api/nope',
    headers: { host: '127.0.0.1:43120' },
    body: '{}',
  }), response)
  assert.equal(response.state.status, 404)
  assert.match(response.state.body, /not-found/)
})

await check('a non-POST call to a JSON endpoint is refused', async () => {
  const response = fakeResponse()
  await route.handler(fakeRequest({ method: 'GET', headers: { host: '127.0.0.1:43120' } }), response)
  assert.equal(response.state.status, 405)
})

await check('an unknown asset name is refused instead of served', async () => {
  const response = fakeResponse()
  await route.handler(fakeRequest({
    method: 'GET',
    url: '/md-preview/api/asset?name=../../etc/passwd',
    headers: { host: '127.0.0.1:43120' },
  }), response)
  assert.equal(response.state.status, 404)
  assert.match(response.state.body, /unknown asset/)
})

await check('the asset endpoint serves the installed KaTeX build', async () => {
  const response = fakeResponse()
  await route.handler(fakeRequest({
    method: 'GET',
    url: '/md-preview/api/asset?name=katex',
    headers: { host: '127.0.0.1:43120' },
  }), response)
  assert.equal(response.state.status, 200)
  assert.ok(response.state.body.includes('KaTeX'), 'the served asset is not the KaTeX build')
})

// --- client bundle contract ------------------------------------------------

const bundle = await readFile(resolve(root, 'lib/client.js'), 'utf8').catch(() => undefined)

await check('the client bundle exists (run npm run build)', () => {
  assert.notEqual(bundle, undefined, 'lib/client.js is missing')
})

if (bundle !== undefined) {
  await check('the bundle is a single-file lazy-CJS factory', () => {
    assert.match(bundle.slice(0, 400), /window\.__ModuleLoader__\.load\(\{/)
    assert.match(bundle, /id:\s*"dsh-md-preview"/)
    assert.ok(bundle.trimEnd().endsWith('});'), 'wrapper is not closed')
  })

  await check('react stays external and no node builtin is bundled', () => {
    assert.ok(bundle.includes('require("react")'), 'react is not required from the host')
    // The automatic JSX runtime is what keeps a JSX module from having to
    // remember `import React`; without this import the bundle renders nothing.
    assert.ok(bundle.includes('react/jsx-runtime'), 'the automatic JSX runtime is not imported')
    assert.ok(!/require\("node:/.test(bundle), 'a node builtin leaked into the browser bundle')
  })

  await check('the bundle registers every extension point it needs', () => {
    for (const needle of [
      'conversation.session.header.utilities',
      'sidebar.right.pane.tab',
      'md-preview-tree',
      '"*.md"',
    ]) {
      assert.ok(bundle.includes(needle), `missing registration: ${needle}`)
    }
  })

  await check('mermaid is not bundled (it is served on demand)', () => {
    // The library registers `mermaidAPI`; its absence proves the heavy
    // dependency travels over /md-preview/api/asset instead of in the bundle.
    assert.ok(!bundle.includes('mermaidAPI'), 'mermaid was inlined into the bundle')
  })

  await check('KaTeX is not bundled either (only its TeX parser is)', () => {
    // The TeX *syntax* is part of the bundle (@mdit/plugin-tex); the KaTeX
    // renderer is not. Assert on one of KaTeX's own error strings rather than
    // on its name — the name legitimately appears in this plugin's own CSS
    // comments and messages.
    assert.ok(!bundle.includes('KaTeX parse error'), 'katex was inlined into the bundle')
    assert.ok(bundle.includes('math_inline'), 'the tex syntax plugin is missing')
  })

  await check('the bundle stays within the weight budget', () => {
    assert.ok(bundle.length < 2_000_000, `client.js is ${bundle.length} bytes`)
  })

  await check('ColaMD stylesheets are fully scoped to the container', () => {
    // Comments may name upstream selectors while explaining them (they are part
    // of the inlined stylesheet text), so strip them first: what must not survive
    // is an actual unscoped selector.
    const css = bundle.replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!css.includes('#editor'), 'an unscoped ColaMD selector reached the bundle')
    assert.ok(!bundle.includes('@keyframes heading-flash'), 'upstream keyframes would go global')
    // The upstream sheet opens with a global `*` rule; unscoped it restyles the
    // whole shell — this actually broke the desktop client once.
    assert.ok(bundle.includes('.mdp-md *'), 'the upstream global * rule was not scoped')
    assert.ok(bundle.includes('.mdp-md.theme-'), 'theme classes are not scoped to the container')
  })

  await check('the VuePress theme and the back-to-top affordance ship', () => {
    // vendor/extra/*.css goes through the same scoping pass as the vendored
    // themes; if that directory ever stops being scanned this fails, instead of
    // silently shipping twelve themes and no self-maintained one.
    assert.ok(bundle.includes('.mdp-md.theme-vuepress h2'), 'the light VuePress theme is not in the bundle')
    assert.ok(bundle.includes('.mdp-md.theme-vuepress-dark h2'), 'the dark VuePress theme is not in the bundle')
    // The button is hidden by opacity, not by removal, so "hidden" has to mean
    // "invisible *and* not clickable" — otherwise it eats clicks over the text.
    const button = /\.mdp-top \{[^}]*\}/.exec(bundle)?.[0] ?? ''
    assert.ok(button.includes('opacity: 0'), `the back-to-top button starts visible: ${button}`)
    assert.ok(button.includes('pointer-events: none'), 'the hidden back-to-top button still takes clicks')
    assert.ok(bundle.includes('.mdp-top[data-visible='), 'the back-to-top button could never appear')
    // VuePress's button is a circle with a reading-progress ring around the arrow.
    assert.ok(button.includes('border-radius: 50%'), `the button is not the VuePress circle: ${button}`)
    assert.ok(bundle.includes('.mdp-top-progress'), 'the reading-progress ring is missing')
    // The button is a sibling of the document container, not a descendant, so the
    // theme's custom properties cannot reach it — a themed colour here would fall
    // back to its default (white) inside a dark theme.
    for (const leased of ['var(--bg-color', 'var(--text-color', 'var(--link-color']) {
      assert.ok(!button.includes(leased), `the button reads a theme variable it cannot inherit: ${leased}`)
    }
  })
}

await check('both VuePress variants are selectable, light and dark', async () => {
  // Labels are read from the generated module, not grepped out of the bundle:
  // esbuild writes non-ASCII as \uXXXX escapes, so searching the bundle for
  // "深色" fails even though the runtime string is correct.
  const { THEMES } = await import('../src/client/colamd.generated.js')
  const light = THEMES.find((theme) => theme.id === 'vuepress')
  const dark = THEMES.find((theme) => theme.id === 'vuepress-dark')
  assert.equal(light?.label, 'VuePress')
  assert.equal(light?.dark, false)
  assert.equal(dark?.label, 'VuePress 深色')
  assert.equal(dark?.dark, true, 'a dark variant that is not marked dark keeps light Shiki and Mermaid')
})

await check('the container rules out the upstream viewport assumptions', async () => {
  // The document container is upstream's body AND its .ProseMirror at once, so
  // .ProseMirror's max-width: 780px + margin: 0 auto shrank the very element that
  // paints the theme background to a centred column — the page colour stopped at
  // 780px and the host showed through beside it, on all 14 themes. #editor's
  // viewport-height rule and body's height:100% + overflow:hidden were the same
  // leak, and dropping overflow also killed scrollTop, which back-to-top and
  // scroll retention both read.
  const bundle = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  const block = /\.mdp-root \.mdp-md \{([^}]*)\}/.exec(bundle)?.[1] ?? ''
  assert.notEqual(block, '', 'the container override is gone')
  assert.ok(block.includes('max-width: none'), `the theme background would stop short: ${block}`)
  assert.ok(block.includes('margin: 0'), 'the container is not pinned to the panel edges')
  assert.ok(block.includes('overflow: auto'), 'the container stopped scrolling, so scrollTop stays 0')
})

await check('every theme satisfies the colour contract', async () => {
  const { CSS, THEMES } = await import('../src/client/colamd.generated.js')
  const { REQUIRED_NAMES } = await import('../scripts/theme-spec.mjs')
  for (const theme of THEMES) {
    const block = new RegExp(`\\.mdp-md\\.theme-${theme.id}[\\s,]*\\{([^}]*)\\}`).exec(CSS)
    assert.notEqual(block, null, `${theme.id} has no variable block`)
    const missing = REQUIRED_NAMES.filter((name) => !block[1].includes(`${name}:`))
    assert.deepEqual(missing, [], `${theme.id} is missing ${missing.join(', ')}`)
  }
  // The template has to be contract-complete as well, or a theme copied from it
  // starts life failing the build.
  const template = await readFile(resolve(root, 'templates/theme.css'), 'utf8')
  const missing = REQUIRED_NAMES.filter((name) => !template.includes(`${name}:`))
  assert.deepEqual(missing, [], `templates/theme.css is missing ${missing.join(', ')}`)
})

await check('typography defaults to 霞鹜文楷 and a Cascadia Code stack', async () => {
  const bundle = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  assert.ok(bundle.includes('--content-font') && bundle.includes('LXGW WenKai'), 'the body face is not 霞鹜文楷')
  assert.ok(bundle.includes('--code-font') && bundle.includes('Cascadia Code'), 'code is not Cascadia Code')
  assert.ok(bundle.includes('Microsoft YaHei'), 'code has no CJK fallback behind Cascadia Code')
  // Three classes: upstream hard-codes its stacks at one class and a theme sets
  // font-family at two, so anything weaker would lose to one of them and the
  // preview's typography would depend on the theme.
  const body = /\.mdp-root \.mdp-doc \.mdp-md \{[^}]*\}/.exec(bundle)?.[0] ?? ''
  assert.ok(body.includes('font-family: var(--content-font)'), `no body font rule: ${body}`)
  const code = /\.mdp-root \.mdp-doc \.mdp-md code[^{]*\{[^}]*\}/.exec(bundle)?.[0] ?? ''
  assert.ok(code.includes('font-family: var(--code-font)'), `no code font rule: ${code}`)
})

await check('the render effect depends on the theme id, not just its lightness', async () => {
  // Picking another theme of the same lightness changes the Shiki palette without
  // changing darkTheme; keying the render on darkTheme alone left the previous
  // palette's inline colours in the code blocks, so switching themes looked like
  // it did nothing.
  const source = await readFile(resolve(root, 'src/client/panel.jsx'), 'utf8')
  const deps = /renderMarkdown\([\s\S]*?\}, \[([^\]]*)\]\)/.exec(source)
  assert.notEqual(deps, null, 'the markdown render effect is gone')
  assert.ok(deps[1].includes('themeId'), `the render effect ignores the theme: [${deps[1]}]`)
})

await check('every service the client half reads is a declared one', async () => {
  // cordis throws on `ctx.x` for an undeclared service, and a *probe* (`ctx.get`)
  // can run before the provider exists — which silently skips registration. So
  // the rule is not "never touch ctx.x", it is "ctx.x must be declared in
  // `inject`", and `inject` is what makes cordis wait. Comments are stripped
  // first: prose explaining the rule must not trip it.
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const entry = strip(await readFile(resolve(root, 'src/client/index.jsx'), 'utf8'))
  const declaredLiteral = /export const inject = (\[[^\]]*\])/.exec(entry)
  assert.notEqual(declaredLiteral, null, 'the client entry declares no inject list')
  const declared = JSON.parse(declaredLiteral[1].replace(/'/g, '"'))
  const builtins = new Set(['get', 'effect', 'on', 'inject'])

  for (const file of ['src/client/index.jsx', 'src/client/panel.jsx']) {
    const source = strip(await readFile(resolve(root, file), 'utf8'))
    for (const match of source.matchAll(/ctx\.([A-Za-z_$][\w$]*)/g)) {
      const name = match[1]
      if (builtins.has(name)) continue
      assert.ok(declared.includes(name), `${file} reads ctx.${name}, which is not in inject`)
    }
  }
})

await check('the panels take their session from the standard props', async () => {
  // The session id is a *standard prop* handed to every slot component; it is
  // not on the tab record (that carries id/kind/title/contentId only). Reading
  // it from the wrong place silently yields an empty file tree.
  const source = await readFile(resolve(root, 'src/client/panel.jsx'), 'utf8')
  for (const name of ['PreviewPanel', 'TreePanel']) {
    assert.match(
      source,
      new RegExp(`function ${name}\\(\\{[^}]*sessionId`),
      `${name} does not accept the sessionId standard prop`,
    )
  }
  assert.ok(!/currentSessionId\(/.test(source), 'the speculative session lookup is back — use the standard prop')
})

await rm(scratch, { recursive: true, force: true })

const failed = results.filter(([ok]) => !ok)
for (const [ok, name] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
