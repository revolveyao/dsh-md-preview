/**
 * TeX rendering with KaTeX, loaded only when a document actually contains math.
 *
 * The library is not bundled: it is 272 KB of parser that most documents never
 * need, and the plugin loader serves exactly one file per plugin, so bundling
 * it would charge every session for it. Instead the host serves this package's
 * node_modules copy on first use, exactly as it does for Mermaid.
 *
 * Output is MathML only (`output: 'mathml'`). That choice is what makes KaTeX
 * fit here at all: the HTML mode needs katex.min.css plus 20 woff2 files
 * (254 KB) that a single-file bundle cannot ship as siblings, while MathML is
 * rendered natively by the browser with no stylesheet and no web font.
 *
 * Parsing is not this module's job — `@mdit/plugin-tex` owns the delimiter
 * rules (`$…$`, `$$…$$`, and the heuristics that keep a stray `$5` out of the
 * math). This module only answers its `render` callback.
 */

/** In-flight or settled library load; the script tag is added at most once. */
let loading

/** Whether KaTeX is present and ready to render synchronously. */
export function katexReady() {
  return globalThis.katex !== undefined
}

function loadLibrary() {
  if (globalThis.katex !== undefined) return Promise.resolve(globalThis.katex)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/md-preview/api/asset?name=katex'
    script.async = true
    script.onload = () => {
      if (globalThis.katex !== undefined) resolve(globalThis.katex)
      else reject(new Error('katex asset loaded without registering window.katex'))
    }
    script.onerror = () => {
      loading = undefined
      reject(new Error('katex asset is unavailable (is the katex dependency installed?)'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/**
 * Make sure KaTeX is loaded before a render pass that will need it.
 * @returns true when the library is usable; failures are swallowed because a
 *   document must still render its maths as source text.
 */
export async function ensureKatex() {
  try {
    await loadLibrary()
    return true
  } catch {
    return false
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character])
}

/**
 * Render one TeX snippet.
 * @param content - the TeX source.
 * @param displayMode - true for `$$…$$` (block), false for `$…$` (inline).
 * @returns markup; when KaTeX is missing or the formula is invalid the source is
 *   shown as code instead of being dropped, so the document keeps its meaning.
 */
export function renderMath(content, displayMode) {
  const library = globalThis.katex
  if (library === undefined) {
    // Late arrival: start the load so the next render succeeds, and show source.
    void loadLibrary().catch(() => {})
    return `<code class="mdp-math">${escapeHtml(content)}</code>`
  }
  try {
    return library.renderToString(content, { displayMode, output: 'mathml', throwOnError: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `<code class="mdp-math-error" title="${escapeHtml(message)}">${escapeHtml(content)}</code>`
  }
}
