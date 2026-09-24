/**
 * The markdown renderer: one markdown-exit instance shared by every document.
 *
 * Reused plugins instead of hand-rolled parsing:
 * - `@mdit/plugin-anchor` gives every heading a stable, de-duplicated id (the
 *   preview needs ids; the side outline needs the same ids to scroll to).
 * - Shiki highlighting rides markdown-exit's own `highlight` option (the
 *   documented integration point), which means one async code path for every
 *   fence and markdown-exit's escaped fallback whenever a grammar is absent.
 * A small core rule then collects the heading outline into `env.headings` —
 * there is no toc plugin in the markdown-exit ecosystem, and generating the
 * outline as data is what the side panel actually needs.
 *
 * Math (`$…$` inline, `$$…$$` block) is parsed by `@mdit/plugin-tex` and
 * rendered by KaTeX, fetched on demand — see math.js for why it is not bundled.
 *
 * Deliberately out of scope: task lists, footnotes and raw HTML. `html` stays
 * off, so raw HTML in a document renders as literal text instead of markup.
 *
 * Every link and image is validated here rather than trusted: `html` stays off
 * (raw HTML is escaped), `javascript:`/`data:`-style srcs are dropped, and
 * relative images are rewritten to the host's raw endpoint so a document's
 * local pictures render without exposing the filesystem.
 */
import { createMarkdownExit } from 'markdown-exit'
import { anchor } from '@mdit/plugin-anchor'
import { tex } from '@mdit/plugin-tex'
import { highlightCode } from './highlight.js'
import { ensureKatex, renderMath } from './math.js'

/** Heading levels the outline collects and anchors are created for. */
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6]

const md = createMarkdownExit({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
  highlight: (code, lang, _attrs, env) => highlightCode(code, lang.toLowerCase(), env?.theme, env?.dark),
})

md.use(anchor, { level: HEADING_LEVELS, tabIndex: false })

// `$…$` and `$$…$$`, parsed by @mdit/plugin-tex and rendered by KaTeX, which is
// fetched on demand (see math.js) — the delimiter heuristics that keep prose
// like "$5" out of the math are the plugin's, not ours.
md.use(tex, {
  delimiters: 'dollars',
  render: (content, displayMode) => renderMath(content, displayMode),
})

/** External protocols a rendered link or image may keep. */
const SAFE_PROTOCOL = /^(https?:|mailto:|#)/i

/** Markdown extensions an in-document link may point at and be opened here. */
const DOC_EXTENSION = /\.(md|markdown|mdx)$/i

/**
 * Collect the heading outline into `env.headings`, after the anchor plugin has
 * assigned ids. Headings are read from tokens rather than from a regex over the
 * source, so code blocks containing `#` lines never pollute the outline.
 */
md.core.ruler.push('md_preview_headings', (state) => {
  const tokens = state.tokens
  const headings = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue
    const inline = tokens[index + 1]
    const text = inline?.type === 'inline'
      ? (inline.children ?? []).filter((child) => child.type === 'text' || child.type === 'code_inline').map((child) => child.content).join('')
      : ''
    headings.push({ level: Number(token.tag.slice(1)), id: token.attrGet('id') ?? '', title: text })
  }
  state.env.headings = headings
})

/** The built-in fence rule (highlight plus pre/code wrapping), kept as fallback. */
const defaultFence = md.renderer.rules.fence
const defaultImage = md.renderer.rules.image
const defaultLinkOpen = md.renderer.rules.link_open

/** Absolute path of a document-relative reference, or undefined when external. */
function resolveLocal(reference, env) {
  if (reference === '' || /^[a-z][a-z0-9+.-]*:/i.test(reference)) return undefined
  if (reference.startsWith('#')) return undefined
  const base = typeof env?.docPath === 'string' ? env.docPath.replace(/[\\/][^\\/]*$/, '') : ''
  if (/^[\\/]/.test(reference)) return reference.replace(/^[\\/]+/, '')
  return base === '' ? reference : `${base}/${reference}`
}

/** URL of the host endpoint that serves a local image. */
function rawUrl(path, env) {
  const sessionId = typeof env?.sessionId === 'string' ? env.sessionId : ''
  return `/md-preview/api/raw?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
}

// ```mermaid fences become a placeholder element; the panel renders it on
// demand (and falls back to this source block when the diagram is invalid).
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const lang = (token.info ?? '').trim().split(/\s+/)[0].toLowerCase()
  if (lang === 'mermaid') {
    const source = encodeURIComponent(token.content)
    const escaped = token.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<div class="mdp-mermaid" data-mermaid-source="${source}"><pre class="mdp-mermaid-source"><code>${escaped}</code></pre></div>\n`
  }
  return defaultFence !== undefined
    ? defaultFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

// Local images go through the host's raw endpoint; anything with a protocol
// outside the whitelist loses its src entirely.
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src') ?? ''
  if (!SAFE_PROTOCOL.test(src)) {
    const local = resolveLocal(src, env)
    if (local === undefined) token.attrSet('src', '')
    else token.attrSet('src', rawUrl(local, env))
  }
  return defaultImage !== undefined
    ? defaultImage(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

// In-document links to other markdown files are marked for the panel to open
// in place; everything else keeps the whitelist treatment.
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const href = token.attrGet('href') ?? ''
  const local = resolveLocal(href, env)
  if (local !== undefined && DOC_EXTENSION.test(local.split('#')[0])) {
    token.attrSet('data-mdp-doc', encodeURIComponent(local))
    token.attrSet('href', '#')
  } else if (!SAFE_PROTOCOL.test(href)) {
    token.attrRemove('href')
  } else if (/^https?:/i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen !== undefined
    ? defaultLinkOpen(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

/**
 * Render one document.
 * @param text - markdown source.
 * @param env - render context: `{ sessionId, docPath, theme }`. The outline is
 *   written back onto it as `headings`.
 * @returns the HTML plus the heading outline for the side panel.
 */
export async function renderMarkdown(text, env) {
  const context = { ...env, headings: [] }
  // The math render callback is synchronous, so KaTeX has to be in place before
  // the pass starts. Documents without a `$` never load it.
  if (text.includes('$')) await ensureKatex()
  const html = await md.renderAsync(text, context)
  return { html, headings: context.headings }
}
