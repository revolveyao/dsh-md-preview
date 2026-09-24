/**
 * dsh-md-preview — browser half.
 *
 * Three registrations, all on documented extension points:
 * 1. a markdown tab type that claims `*.md`, so a click on a markdown reference
 *    in the conversation (or in the built-in Files tree) opens this preview
 *    instead of the read-only document viewer — `extension` outranks the
 *    built-in `fallback` type, and claiming it gives the body the whole tab;
 * 2. a page tab showing just the file tree (workspace + skill roots);
 * 3. the header button, parked next to the memory button in the session
 *    header's utilities row.
 *
 * Failure policy: a missing service logs and leaves the rest inert. A throwing
 * client `apply` would fail the whole web shell boot.
 */
import React from 'react'
import { documentName, parseDocumentAddress } from './address.js'
import { openFloating } from './float.js'
import { Icon } from './icons.jsx'
import { PreviewPanel, TreePanel } from './panel.jsx'
import { ensureStyles } from './styles.js'
import { ensureThemeStyles } from './theme.js'

/** Required service: the slot registry. The sidebar services are probed. */
/**
 * Required services.
 *
 * `sidebarRight` / `sidebarRightTabs` are *declared* rather than probed with
 * `ctx.get`. A declaration makes cordis wait for them before running `apply`,
 * while a probe can run before the sidebar plugin has provided them — the tab
 * types then register nothing, and the header button throws
 * `no tab type is registered as "md-preview-tree"` when it is clicked.
 */
export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

/** Re-exported so the load test can drive these without react-dom. */
export { defaultFloatRect, openFloating, requestDock, requestFloat } from './float.js'
export { shikiThemeFor } from './highlight.js'
// Panel behaviour worth asserting without a DOM renderer (see tests).
export { RING_CIRCUMFERENCE, scrollProgress, scrollToTop } from './panel.jsx'

/** Tab implementation ids; each also keys its body registration. */
const PREVIEW_ID = 'dsh-md-preview/markdown'
const TREE_ID = 'dsh-md-preview/tree'

/** Tab kinds, used with `sidebarRight.openTab`. */
const PREVIEW_KIND = 'md-preview'
const TREE_KIND = 'md-preview-tree'

/** The keyed slot every sidebar tab body registers into. */
const TAB_BODY_SLOT = 'sidebar.right.pane.tab'

/** Extensions the preview claims; the built-in markdown viewer keeps the rest. */
const MARKDOWN_PATTERNS = ['*.md', '*.markdown', '*.mdx']

export function apply(ctx) {
  try {
    ensureStyles()
    ensureThemeStyles()
  } catch (error) {
    console.warn(`[dsh-md-preview] styles could not be injected: ${error.message}`)
  }

  // Declared above, so these are plain reads — and cordis guarantees they exist
  // by the time `apply` runs.
  const tabs = ctx.sidebarRightTabs
  const sidebar = ctx.sidebarRight
  const slots = ctx.slots
  if (typeof slots?.inject !== 'function' || typeof slots?.register !== 'function'
    || typeof tabs?.register !== 'function' || typeof sidebar?.openResource !== 'function') {
    console.warn('[dsh-md-preview] sidebar-right services unavailable — the preview stays unregistered')
    return
  }

  // 1. The document face: one tab per markdown file.
  ctx.effect(() => tabs.register({
    id: PREVIEW_ID,
    kind: PREVIEW_KIND,
    patterns: MARKDOWN_PATTERNS,
    priority: 'extension',
    canOpen: (address) => parseDocumentAddress(address) !== undefined,
    title: (address) => documentName(parseDocumentAddress(address)?.path ?? address),
  }), 'md-preview: markdown tab type')
  ctx.effect(() => slots.inject(TAB_BODY_SLOT, () => slots.register({
    name: TAB_BODY_SLOT,
    key: PREVIEW_ID,
  }, (props) => React.createElement(PreviewPanel, { ...props, sidebar }))), 'md-preview: markdown tab body')

  // 2. The tree face: a page tab, opened by the header button.
  ctx.effect(() => tabs.register({
    id: TREE_ID,
    kind: TREE_KIND,
    title: () => 'Markdown 文件树',
  }), 'md-preview: tree tab type')
  ctx.effect(() => slots.inject(TAB_BODY_SLOT, () => slots.register({
    name: TAB_BODY_SLOT,
    key: TREE_ID,
  }, (props) => React.createElement(TreePanel, { ...props, sidebar }))), 'md-preview: tree tab body')

  // 3. The header button, immediately right of the memory button.
  slots.inject('conversation.session.header.utilities', () => slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-md-preview',
    order: 0,
  }, () => React.createElement(HeaderButton, { sidebar })))
}

/**
 * The paperclip: opens the file tree, or brings it forward when it is already
 * open (the sidebar focuses an existing tab of the same kind and pane).
 */
function HeaderButton({ sidebar }) {
  const open = () => {
    if (typeof sidebar?.openTab !== 'function') {
      console.warn('[dsh-md-preview] sidebar-right is unavailable')
      return
    }
    // `openTab` also expands the docked column ("what the user cannot see does
    // not count as open"); `openFloating` folds it back when we caused that, so
    // the tree arrives as a window and the conversation keeps its width.
    try {
      openFloating(sidebar, () => sidebar.openTab(TREE_KIND))
    } catch (error) {
      // `openTab` throws for an unregistered kind or an unbound session dock
      // face; naming the reason beats a button that silently does nothing.
      console.error(`[dsh-md-preview] could not open the file tree: ${error.message}`)
    }
  }
  return React.createElement('button', {
    type: 'button',
    className: 'mdp-btn',
    title: 'Markdown 文件树',
    'aria-label': 'Markdown 文件树',
    onClick: open,
  }, React.createElement(Icon, { name: 'paperclip' }))
}
