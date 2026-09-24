/**
 * Mermaid diagrams, loaded only when a document actually contains one.
 *
 * The library is deliberately NOT bundled: client.js would carry several
 * megabytes for every session, and the plugin loader serves exactly one file
 * per plugin. Instead the host half serves this package's node_modules copy on
 * first use (`/md-preview/api/asset?name=mermaid`) — same origin, offline, no
 * CDN. The published markdown-exit-mermaid plugin was evaluated and rejected:
 * it imports node:fs, defaults to a jsDelivr URL, and injects a <script> tag
 * into its HTML, which never executes once React sets innerHTML.
 *
 * `securityLevel: 'strict'` keeps Mermaid's own sanitiser in charge of the SVG
 * this ends up inserting.
 */

/** In-flight or settled library load; the script tag is added at most once. */
let loading

function loadLibrary() {
  if (globalThis.mermaid !== undefined) return Promise.resolve(globalThis.mermaid)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/md-preview/api/asset?name=mermaid'
    script.async = true
    script.onload = () => {
      if (globalThis.mermaid !== undefined) resolve(globalThis.mermaid)
      else reject(new Error('mermaid asset loaded without registering window.mermaid'))
    }
    script.onerror = () => {
      loading = undefined
      reject(new Error('mermaid asset is unavailable (is the mermaid dependency installed?)'))
    }
    document.head.appendChild(script)
  })
  return loading
}

let initialized
let idCounter = 0

/**
 * Render Mermaid source into SVG markup.
 * @param code - the diagram source from a ```mermaid fence.
 * @param theme - the preview theme's luminance (`light` / `dark`).
 * @returns SVG markup, ready to insert.
 * @throws when the library is unavailable or the diagram is invalid — callers
 *   keep the original source block visible and show the reason.
 */
export async function renderMermaid(code, theme) {
  const mermaid = await loadLibrary()
  if (initialized !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default' })
    initialized = theme
  }
  idCounter += 1
  const { svg } = await mermaid.render(`mdp-mermaid-${idCounter}`, code)
  return svg
}
