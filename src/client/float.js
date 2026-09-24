/**
 * Floating panels.
 *
 * The preview and the tree open as floating panels rather than docked tabs, so
 * neither ever takes width away from the conversation. This uses the sidebar's
 * own `float(tabId, rect?)`:
 *
 * - the floating host is a portal on `document.body` (`position: fixed;
 *   z-index: 60; pointer-events: none`), so no layout column is involved;
 * - the call is idempotent ("a missing or floating tab is left alone").
 *
 * Three details of that API shape this module:
 *
 * 1. **It is silent.** `float` returns without a word when the tab has not
 *    landed in the layout yet (or the session's dock face is not mounted) —
 *    exactly the state a freshly-opened tab can be in. So we ask a few times
 *    over the first second; once the tab floats the later calls are ignored, and
 *    the retry window closes long before a user who docks it back would be
 *    fighting us.
 * 2. **Its default geometry is a cascade**, `{ x: 160 + 24·n, y: 120 + 24·n }`
 *    with a fixed size (dockkit's `planFloatTab`, inlined into the web bundle).
 *    We pass our own `{ x, y, width, height }` instead: one panel anchored to
 *    the top-right, which is where both faces open so the tree and the document
 *    never sit in different corners of the screen.
 * 3. **Every open expands the docked column** — `openTab` *and* `openResource` —
 *    because "what the user cannot see does not count as open". A floating panel
 *    renders whether or not that column is expanded, so `openFloating` folds the
 *    column back when — and only when — we are the reason it expanded.
 *
 * Exported as plain functions too (and re-exported by the plugin entry) so the
 * load test can assert the host calls and the geometry — a component's mount
 * effect cannot be exercised without react-dom.
 */
import { useEffect } from 'react'

/** How many times, and how far apart, the float request is retried. */
const ATTEMPTS = 8
const RETRY_MS = 150
/** Gap kept between the floating panel and the window edges. */
const MARGIN = 24
/** Space left above the panel for the session header. */
const HEADER = 72
/** Opening size bounds of a panel, in CSS pixels. */
const MIN_WIDTH = 280
/**
 * Wide enough for a document plus the tree or outline column beside it — at the
 * previous 560px cap the text column came out around 300px wide. On a 1280px
 * window this puts the panel slightly across the midline; it is still anchored to
 * the right edge, and it shrinks to fit a narrow viewport rather than overflowing.
 */
const MAX_WIDTH = 700
const MIN_HEIGHT = 240
const MAX_HEIGHT = 760

/** Diagnostics that must not repeat on every retry. */
const warned = new Set()

function warnOnce(message) {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`[dsh-md-preview] ${message}`)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * The rectangle a panel opens at: anchored to the top-right and clamped so it
 * always lands on screen.
 * @param viewport - `{ width, height }`; defaults to the live window.
 * @returns `{ x, y, width, height }` in CSS pixels, the shape dockkit expects.
 */
export function defaultFloatRect(viewport) {
  const width = viewport?.width ?? (typeof window === 'undefined' ? 1280 : window.innerWidth)
  const height = viewport?.height ?? (typeof window === 'undefined' ? 800 : window.innerHeight)
  const panelWidth = Math.min(
    clamp(width - MARGIN * 2, MIN_WIDTH, MAX_WIDTH),
    Math.max(160, width - MARGIN),
  )
  const panelHeight = Math.min(
    clamp(height - HEADER - MARGIN, MIN_HEIGHT, MAX_HEIGHT),
    Math.max(160, height - HEADER),
  )
  return {
    x: Math.max(0, width - panelWidth - MARGIN),
    y: Math.max(0, Math.min(HEADER, height - panelHeight)),
    width: panelWidth,
    height: panelHeight,
  }
}

/**
 * Run an open that also expands the docked column, and fold the column back
 * when we caused that expansion.
 * @param sidebar - the `sidebarRight` service.
 * @param open - the call itself (`openTab` / `openResource`).
 * @returns whatever `open` returned.
 */
export function openFloating(sidebar, open) {
  const wasExpanded = sidebar?.isExpanded?.() === true
  const result = open()
  if (!wasExpanded) sidebar?.toggleExpanded?.()
  return result
}

/**
 * Ask the sidebar to float one tab.
 * @param sidebar - the `sidebarRight` service.
 * @param tabId - the tab to float.
 * @param rect - where to open it; omit for the host's own cascade.
 * @returns whether a call was made — the host may still ignore it silently, see
 *   the header comment.
 */
export function requestFloat(sidebar, tabId, rect) {
  if (typeof tabId !== 'string' || tabId === '') return false
  if (typeof sidebar?.float !== 'function') {
    warnOnce('sidebarRight.float is unavailable — panels stay docked')
    return false
  }
  try {
    sidebar.float(tabId, rect)
    return true
  } catch (error) {
    warnOnce(`could not float the panel: ${error.message}`)
    return false
  }
}

/**
 * Ask the sidebar to dock a floating pane back into the right column.
 *
 * The floating layer's own control does not do this in our case, so the panel
 * carries its own button. Like `float`, `dock` ignores an unknown or already
 * docked pane, so pressing it when the panel is docked is a no-op rather than an
 * error.
 * @param sidebar - the `sidebarRight` service.
 * @param paneId - the pane to dock (`useTabInfo().panel.id`).
 * @returns whether a call was made.
 */
export function requestDock(sidebar, paneId) {
  if (typeof paneId !== 'string' || paneId === '') return false
  if (typeof sidebar?.dock !== 'function') {
    warnOnce('sidebarRight.dock is unavailable — the panel stays floating')
    return false
  }
  try {
    sidebar.dock(paneId)
    return true
  } catch (error) {
    warnOnce(`could not dock the panel: ${error.message}`)
    return false
  }
}

/** Float this tab when it is first shown, at the panel's opening rectangle. */
export function useFloatOnOpen(sidebar, tabId) {
  useEffect(() => {
    if (typeof tabId !== 'string' || tabId === '') {
      warnOnce('this tab has no id — the panel cannot be floated')
      return undefined
    }
    // Measured once: a retry must ask for the same place, not re-measure.
    const rect = defaultFloatRect()
    let cancelled = false
    let timer
    let attempt = 0
    const tick = () => {
      if (cancelled) return
      attempt += 1
      requestFloat(sidebar, tabId, rect)
      if (attempt < ATTEMPTS) timer = setTimeout(tick, RETRY_MS)
    }
    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [sidebar, tabId])
}
