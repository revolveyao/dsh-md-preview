/**
 * Turn the vendored ColaMD stylesheets into one JS module the client bundle can
 * inline.
 *
 * Why a build step instead of importing the .css directly: the plugin loader
 * serves a single client.js per plugin, so a stylesheet cannot ship as a sibling
 * file — the CSS has to arrive as a string inside the bundle. The vendored files
 * stay byte-identical to upstream (`vendor/colamd/upstream.json` records the
 * commit), so upgrading is "re-sync vendor, rebuild". Themes this plugin writes
 * itself live in `vendor/extra/` and are treated identically, so an upstream
 * re-sync cannot clobber them.
 *
 * Why the *whole* sheet is scoped, not a handful of selectors: `base.css` is an
 * application stylesheet. It opens with `*, *::before, *::after`, styles its own
 * chrome (`#titlebar`, `#tab-bar`, `#outline-list`, `#file-panel`, …) and
 * declares global keyframes. Rewriting only `#editor` / `body.theme-*` leaves
 * every other top-level rule global — and a leaked `*` rule restyles the entire
 * DSH shell (observed in practice: the desktop client's layout broke). So here
 * every top-level rule is confined to `.mdp-md`, this preview's document
 * container, nested at-rules are scoped recursively, and the build fails if any
 * selector escapes.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { missingVariables } from './theme-spec.mjs'

/** Display names for the themes ColaMD ships; unknown ids keep their raw name. */
const THEME_LABELS = {
  light: '浅色', dark: '深色', elegant: '雅致', notion: '简白', writer: '作家',
  bear: '熊红', sepia: '羊皮纸', midnight: '午夜', 'solarized-dark': '夜航',
  nord: '极地', gruvbox: '暖木', dracula: '德古拉',
  vuepress: 'VuePress', 'vuepress-dark': 'VuePress 深色',
}

/**
 * Themes this plugin maintains itself, in the same dialect as the vendored ones.
 * Kept out of `vendor/colamd/` so re-syncing upstream can never clobber them.
 */
const EXTRA_THEME_DIR = 'vendor/extra'

/** Themes whose palette is dark — code highlighting and Mermaid follow this. */
const DARK_THEMES = new Set(['dark', 'midnight', 'solarized-dark', 'nord', 'gruvbox', 'dracula', 'vuepress-dark'])

/** The container every ColaMD rule is confined to. */
const CONTAINER = '.mdp-md'

/**
 * Rewrites mapping ColaMD's own anchors onto that container, in order: the theme
 * class has to be claimed before the bare `body` rule can swallow it.
 */
const ANCHORS = [
  [/body\.theme-([a-z0-9-]+)/g, `${CONTAINER}.theme-$1`],
  [/#editor\s+\.ProseMirror/g, CONTAINER],
  [/#editor/g, CONTAINER],
  [/:root/g, CONTAINER],
  [/(^|[^\w.#-])body(?![\w-])/g, `$1${CONTAINER}`],
  [/(^|[^\w.#-])html(?![\w-])/g, `$1${CONTAINER}`],
]

/** At-rules whose body is more rules, scoped recursively. */
const NESTED_AT_RULES = new Set(['media', 'supports', 'layer', 'container'])

/** At-rules a preview has no use for: their names would go global instead. */
const DROPPED_AT_RULES = new Set(['keyframes', 'font-face', 'import', 'charset', 'namespace'])

/**
 * Build the generated module from the vendored stylesheets.
 * @param root - the plugin root (the directory holding `vendor/`).
 * @returns the generated file path.
 */
export async function prepareColamd(root) {
  const vendor = resolve(root, 'vendor/colamd')
  const themeDir = resolve(vendor, 'themes')
  const upstreamIds = await themeIdsIn(themeDir)
  if (upstreamIds.length === 0) {
    throw new Error('missing vendor/colamd/themes/*.css — re-sync the ColaMD stylesheets first')
  }
  const extraDir = resolve(root, EXTRA_THEME_DIR)
  const extra = (await themeIdsIn(extraDir)).map((id) => ({
    id,
    file: resolve(extraDir, `${id}.css`),
    label: `${EXTRA_THEME_DIR}/${id}.css`,
  }))
  const clash = extra.filter((one) => upstreamIds.includes(one.id))
  if (clash.length > 0) {
    throw new Error(`${EXTRA_THEME_DIR} shadows a ColaMD theme id: ${clash.map((one) => one.id).join(', ')}`)
  }
  const themeIds = [...upstreamIds, ...extra.map((one) => one.id)]
  const themeSources = [
    ...upstreamIds.map((id) => ({ id, file: resolve(themeDir, `${id}.css`), label: `vendor/colamd/themes/${id}.css` })),
    ...extra,
  ]

  const selectors = []
  const themeSelectors = []
  const dropped = []
  const incomplete = []
  const parts = []

  for (const name of ['base.css', 'premium.css']) {
    const source = await readFile(resolve(vendor, name), 'utf8').catch(() => {
      throw new Error(`missing vendor/colamd/${name} — re-sync the ColaMD stylesheets first`)
    })
    parts.push(`/* vendor/colamd/${name} */\n${scopeSheet(source, selectors, dropped)}`)
  }
  for (const { id, file, label } of themeSources) {
    const source = await readFile(file, 'utf8')
    // The colour contract (scripts/theme-spec.mjs, explained in docs/themes.md):
    // a theme that skips a required variable silently inherits the previous
    // theme's value, which reads as a preview bug. Themes maintained here must be
    // complete; the vendored files cannot be edited, so theirs is only reported.
    const missing = missingVariables(source)
    if (missing.length > 0) {
      if (label.startsWith(EXTRA_THEME_DIR)) {
        throw new Error(`${label} is missing required theme variables: ${missing.join(', ')}`)
      }
      incomplete.push(`${id}: ${missing.join(', ')}`)
    }
    // A theme file carries no theme prefix of its own: ColaMD loads one file at a
    // time, so `:root` and `#editor .ProseMirror x` are unambiguous there. Inlined
    // side by side they must be scoped per theme — otherwise the twelve files
    // simply overwrite one another and every theme shows the last file's tweaks
    // (observed in practice: the inline-code colour never changed with the theme).
    const start = selectors.length
    parts.push(`/* ${label} */\n${scopeSheet(source, selectors, dropped, id)}`)
    themeSelectors.push(...selectors.slice(start))
  }

  const css = parts.join('\n')

  // The assertions that make isolation a fact rather than a hope: no rule may
  // reach the document without passing through the container, and no rule from a
  // per-theme file may lose its theme scope.
  const escaped = selectors.filter((selector) => !selector.includes(CONTAINER))
  if (escaped.length > 0) {
    throw new Error(`ColaMD selectors escaped ${CONTAINER}: ${escaped.slice(0, 5).join(' | ')}`)
  }
  const unscopedTheme = themeSelectors.filter((selector) => !selector.includes(`${CONTAINER}.theme-`))
  if (unscopedTheme.length > 0) {
    throw new Error(`a per-theme rule lost its theme scope: ${unscopedTheme.slice(0, 5).join(' | ')}`)
  }
  if (!css.includes(`${CONTAINER} *`)) {
    throw new Error(`the upstream global \`*\` rule was not scoped to ${CONTAINER}`)
  }
  if (css.includes('@media print')) {
    throw new Error('the upstream print block survived')
  }

  const themes = themeIds.map((id) => ({
    id,
    label: THEME_LABELS[id] ?? id,
    dark: DARK_THEMES.has(id),
  }))

  const out = `// Generated by scripts/prepare-colamd.mjs — do not edit.
// Themes come from vendor/colamd/themes/*.css (upstream, byte-identical) and
// vendor/extra/*.css (maintained here); edit those and rebuild.
export const CSS = ${JSON.stringify(css)}

export const THEMES = ${JSON.stringify(themes, null, 2)}
`
  const outFile = resolve(root, 'src/client/colamd.generated.js')
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, out)
  return { outFile, dropped: [...new Set(dropped)], incomplete, rules: selectors.length }
}

/**
 * Scope one stylesheet: every rule is rewritten into the container, nested
 * at-rules are followed, and the rest are dropped.
 * @param source - the stylesheet text.
 * @param selectors - collector for every selector that ends up in the output.
 * @param dropped - collector for at-rule preludes that were removed.
 * @param themeId - set when scoping one of ColaMD's per-theme files, whose rules
 *   must land under that theme's own scope.
 */
function scopeSheet(source, selectors, dropped, themeId) {
  let out = ''
  let index = 0
  while (index < source.length) {
    // Keep leading trivia (whitespace and comments) verbatim. Folding it into
    // the prelude would make `/* … */ @media print` look like a selector — which
    // is exactly how a print block survived an earlier version of this script.
    const trivia = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*/.exec(source.slice(index))[0]
    if (trivia !== '') {
      out += trivia
      index += trivia.length
      if (index >= source.length) break
    }
    const brace = findBrace(source, index)
    if (brace === -1) {
      out += source.slice(index)
      break
    }
    const prelude = source.slice(index, brace).trim()
    const end = findBlockEnd(source, brace)
    const body = source.slice(brace + 1, end)

    if (prelude.startsWith('@')) {
      const name = atRuleName(prelude)
      // `@media print` hides `body > :not(#editor)`: it describes ColaMD's own
      // page chrome and, once scoped, would hide the document itself.
      if (NESTED_AT_RULES.has(name) && !/\bprint\b/.test(prelude)) {
        out += `${prelude}{${scopeSheet(body, selectors, dropped, themeId)}}`
      } else {
        dropped.push(prelude)
      }
    } else {
      const scoped = prelude.split(',').map((part) => scopeSelector(part, themeId)).join(', ')
      for (const one of scoped.split(',')) selectors.push(one.trim())
      out += `${scoped}{${body}}`
    }
    index = end + 1
  }
  return out
}

/** Rewrite one selector so it can only match inside the container. */
function scopeSelector(selector, themeId) {
  let scoped = selector.trim()
  if (scoped === '') return scoped
  if (themeId !== undefined) {
    // A per-theme file: drop the anchors that mean nothing inside it and put the
    // whole rule under this theme's own class.
    scoped = scoped
      .replace(/#editor\s+\.ProseMirror\s*/g, '')
      .replace(/body\.theme-[a-z0-9-]+/g, '')
      .replace(/:root/g, '')
      .trim()
    return scoped === '' ? `${CONTAINER}.theme-${themeId}` : `${CONTAINER}.theme-${themeId} ${scoped}`
  }
  for (const [pattern, replacement] of ANCHORS) scoped = scoped.replace(pattern, replacement)
  // Anything still standing on its own is pulled in: that is what keeps an
  // upstream rule this plugin has never seen from going global.
  if (!scoped.includes(CONTAINER)) scoped = `${CONTAINER} ${scoped}`
  return scoped
}

/** Name of an at-rule prelude (`@media (min-width: …)` → `media`). */
function atRuleName(prelude) {
  return prelude.slice(1).split(/[\s({]/)[0].toLowerCase()
}

/** Theme ids (stylesheets' basenames) in a directory, sorted; missing = none. */
async function themeIdsIn(dir) {
  const names = await readdir(dir).catch(() => [])
  return names
    .filter((name) => name.endsWith('.css'))
    .map((name) => name.slice(0, -'.css'.length))
    .sort()
}

/** Index of the next `{` outside comments and strings, or -1. */
function findBrace(source, start) {
  let quote = ''
  let comment = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (comment) {
      if (character === '*' && next === '/') { comment = false; index += 1 }
      continue
    }
    if (quote !== '') {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && next === '*') { comment = true; index += 1; continue }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '{') return index
    if (character === '}') return -1
  }
  return -1
}

/** Index of the `}` closing the block that starts at `brace`. */
function findBlockEnd(source, brace) {
  let depth = 0
  let quote = ''
  let comment = false
  for (let index = brace; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (comment) {
      if (character === '*' && next === '/') { comment = false; index += 1 }
      continue
    }
    if (quote !== '') {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && next === '*') { comment = true; index += 1; continue }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return source.length - 1
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('prepare-colamd.mjs')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const result = await prepareColamd(root)
  console.log(`generated ${result.outFile} (${result.rules} scoped rules)`)
  if (result.dropped.length > 0) console.log(`dropped at-rules: ${result.dropped.join(' | ')}`)
  if (result.incomplete.length > 0) console.log(`incomplete vendored themes:\n  ${result.incomplete.join('\n  ')}`)
}
