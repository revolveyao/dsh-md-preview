/**
 * On-demand syntax highlighting.
 *
 * Shiki's core entry with the pure-JS regex engine (no WASM sibling file, which
 * the single-file client bundle could not serve), and grammars/themes pulled in
 * by dynamic import only when a document actually uses them. A language outside
 * LANGUAGES is never loaded: `highlightCode` answers with an empty string and
 * markdown-exit escapes the block instead, so an exotic fence costs nothing.
 *
 * The theme follows the *preview* theme rather than its luminance alone, so a
 * reader who picks Dracula gets Dracula-coloured code instead of one of two
 * github palettes. Same-named Shiki themes are used where they exist; the rest
 * are matched by character (warm paper → solarized-light, black-out → vesper).
 * Loading stays per theme: whichever palette is in use is the only one fetched.
 */
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/**
 * Fence languages this preview may load. Keeping the list explicit is what
 * makes "on demand" true — a bundled full Shiki ships every grammar in the
 * package, this list ships only what a viewer of these documents will meet.
 *
 * The list is deliberately small: grammars are the bundle's dominant cost
 * (C++ plus its macro grammar alone is ~20% of it), so languages that only
 * appear in a specialist document set are left out. An unlisted language is
 * still rendered — as an escaped code block, without loading anything.
 */
const LANGUAGES = {
  abap: () => import('@shikijs/langs/abap'),
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  markdown: () => import('@shikijs/langs/markdown'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  sql: () => import('@shikijs/langs/sql'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
}

/** Common aliases so a document's `js` / `sh` fence still highlights. */
const ALIASES = {
  cjs: 'javascript', console: 'bash', h: 'c', js: 'javascript', md: 'markdown',
  mjs: 'javascript', ps1: 'powershell', py: 'python', sh: 'bash', shell: 'bash',
  ts: 'typescript', yml: 'yaml', zsh: 'bash',
}

/** Shiki theme per preview theme (ColaMD ids), matched by name or character. */
const SHIKI_BY_THEME = {
  light: 'github-light',
  dark: 'github-dark',
  elegant: 'rose-pine-dawn',
  notion: 'min-light',
  writer: 'one-light',
  bear: 'github-light',
  sepia: 'solarized-light',
  midnight: 'vesper',
  'solarized-dark': 'solarized-dark',
  nord: 'nord',
  gruvbox: 'gruvbox-dark-medium',
  dracula: 'dracula',
  // VuePress docs print code on a dark #282c34 slab whatever the page theme is;
  // one-dark-pro is that very palette, so the theme reads as the original — and
  // its dark variant shares the slab, so both ids load the one palette.
  vuepress: 'one-dark-pro',
  'vuepress-dark': 'one-dark-pro',
}

/** Fallback palettes for a preview theme this build has never heard of. */
const FALLBACK = { light: 'github-light', dark: 'github-dark' }

/**
 * Loaders by Shiki theme name. Each entry is a dynamic import so a palette is
 * parsed only when a document is actually highlighted with it.
 */
const SHIKI_THEMES = {
  'github-light': () => import('@shikijs/themes/github-light'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
  'rose-pine-dawn': () => import('@shikijs/themes/rose-pine-dawn'),
  'min-light': () => import('@shikijs/themes/min-light'),
  'one-light': () => import('@shikijs/themes/one-light'),
  'solarized-light': () => import('@shikijs/themes/solarized-light'),
  vesper: () => import('@shikijs/themes/vesper'),
  'solarized-dark': () => import('@shikijs/themes/solarized-dark'),
  nord: () => import('@shikijs/themes/nord'),
  'gruvbox-dark-medium': () => import('@shikijs/themes/gruvbox-dark-medium'),
  dracula: () => import('@shikijs/themes/dracula'),
  'one-dark-pro': () => import('@shikijs/themes/one-dark-pro'),
}

/** The shared highlighter instance; grammars stay loaded across documents. */
let highlighter

/** In-flight or finished loads, so one grammar is fetched once per session. */
const pending = new Map()

function core() {
  highlighter ??= createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine() })
  return highlighter
}

function once(key, load) {
  let running = pending.get(key)
  if (running === undefined) {
    running = load().catch((error) => {
      pending.delete(key)
      throw error
    })
    pending.set(key, running)
  }
  return running
}

/**
 * The Shiki theme a preview theme highlights code with.
 * @param themeId - the preview (ColaMD) theme id.
 * @param dark - that theme's luminance; only the fallback needs it.
 * @returns a name this module can load.
 */
export function shikiThemeFor(themeId, dark) {
  const mapped = SHIKI_BY_THEME[themeId]
  if (mapped !== undefined && SHIKI_THEMES[mapped] !== undefined) return mapped
  return dark === true ? FALLBACK.dark : FALLBACK.light
}

/**
 * Highlight one fenced block.
 * @param code - the block's source.
 * @param lang - the fence info string's language part.
 * @param themeId - the active preview theme id.
 * @param dark - whether that theme is dark.
 * @returns the highlighted `<pre>` markup, or `''` to let markdown-exit render
 *   an escaped plain block (unknown language, or a grammar that failed to load).
 */
export async function highlightCode(code, lang, themeId, dark) {
  const name = LANGUAGES[lang] !== undefined ? lang : ALIASES[lang]
  const load = LANGUAGES[name]
  if (load === undefined) return ''
  const shikiName = shikiThemeFor(themeId, dark)
  const themeLoad = SHIKI_THEMES[shikiName]
  try {
    const shiki = await core()
    await once(`lang:${name}`, async () => shiki.loadLanguage((await load()).default))
    await once(`theme:${shikiName}`, async () => shiki.loadTheme((await themeLoad()).default))
    return shiki.codeToHtml(code, { lang: name, theme: shikiName })
  } catch {
    return ''
  }
}
