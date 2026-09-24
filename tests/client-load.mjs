/**
 * Loads the built client bundle the way the DSH web shell does — through
 * `window.__ModuleLoader__`, with the host's own React, inside a real DOM — and
 * drives `apply` against a cordis-like context.
 *
 * This is the only check that catches the failure mode "installed, but no
 * button appeared": a bundle that throws at evaluation, exports the wrong
 * shape, registers nothing, or renders a component that blows up.
 *
 * The host's packages are borrowed from the DSH installation (the browser half
 * is external to them, exactly as in production). Point `DSH_APP_MODULES` at a
 * different installation if this machine's path differs; when they cannot be
 * found the run fails loudly rather than skipping, because a skipped run here
 * would look indistinguishable from a working plugin.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CANDIDATES = [
  process.env.DSH_APP_MODULES,
  join(process.env.LOCALAPPDATA ?? '', 'Programs/DSH Desktop/resources/app/node_modules'),
].filter((candidate) => typeof candidate === 'string' && candidate !== '')

const hostModules = CANDIDATES.find((candidate) => existsSync(join(candidate, 'react')))
if (hostModules === undefined) {
  console.error('cannot locate the DSH app modules (set DSH_APP_MODULES) — the client half is UNVERIFIED')
  process.exit(1)
}
const hostRequire = createRequire(join(hostModules, 'x.js'))

const results = []
/**
 * Run one check, sync or async. An async check's failure must land in the
 * results too: calling `fn()` and pushing "ok" without awaiting it reported a
 * throwing async check as a pass and only surfaced at process exit.
 */
const pending = []
function check(name, fn) {
  try {
    const outcome = fn()
    if (outcome instanceof Promise) {
      pending.push(outcome.then(
        () => results.push([true, name]),
        (error) => results.push([false, `${name} — ${error.message}`]),
      ))
      return
    }
    results.push([true, name])
  } catch (error) {
    results.push([false, `${name} — ${error.message}`])
  }
}

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  pretendToBeVisual: true,
  // A real origin: an opaque one makes localStorage throw, and the panel uses it.
  url: 'http://localhost/',
})
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.CSS = dom.window.CSS ?? { escape: (value) => value }
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame ?? ((fn) => setTimeout(fn, 0))
globalThis.localStorage = dom.window.localStorage

let exported
let loadFailure
dom.window.__ModuleLoader__ = {
  load: (entry) => {
    try {
      exported = entry.factory(hostRequire)
    } catch (error) {
      loadFailure = error
    }
  },
}

try {
  new Function('require', 'window', readFileSync(join(root, 'lib/client.js'), 'utf8'))(hostRequire, dom.window)
} catch (error) {
  loadFailure = error
}

check('the bundle evaluates without throwing', () => {
  assert.equal(loadFailure, undefined, loadFailure?.message)
  assert.notEqual(exported, undefined, 'the loader was never called')
})

check('the bundle exports apply and inject', () => {
  assert.equal(typeof exported.apply, 'function')
  assert.ok(Array.isArray(exported.inject) && exported.inject.includes('slots'), `inject is ${JSON.stringify(exported.inject)}`)
})

/** A context shaped like cordis: declared services are readable properties. */
function makeContext(services) {
  const registrations = []
  const slots = {
    inject: (name, factory) => { registrations.push({ call: 'inject', name }); factory() },
    register: (options, component) => {
      registrations.push({ call: 'register', ...options, component })
      return () => {}
    },
  }
  const context = {
    effect: (fn) => { fn() },
    slots,
    get: (name) => (name === 'slots' ? slots : services[name]),
  }
  for (const [name, service] of Object.entries(services)) context[name] = service
  return { context, registrations }
}

// 1. With the sidebar services present: everything registers.
{
  const tabTypes = []
  const sidebarRight = {
    openResource: () => {},
    openTab: () => {},
    close: () => {},
    active: () => ({ sessionId: 'session-1' }),
  }
  const sidebarRightTabs = { register: (options) => { tabTypes.push(options); return () => {} } }
  const { context, registrations } = makeContext({ sidebarRight, sidebarRightTabs })

  check('apply does not throw with the sidebar services present', () => {
    exported.apply(context)
  })

  check('it registers the markdown tab type, claiming *.md', () => {
    const preview = tabTypes.find((entry) => entry.patterns?.includes('*.md'))
    assert.notEqual(preview, undefined, `tab types registered: ${JSON.stringify(tabTypes.map((t) => t.kind))}`)
    assert.equal(preview.priority, 'extension', 'the built-in markdown viewer would win without the extension rank')
    // `canOpen` answers "is this an address I serve", not "is this a markdown
    // file" — the glob patterns decide extensions; this only rejects addresses
    // that carry no session (a bare `absolute/` address belongs to no preview).
    assert.equal(preview.canOpen('dsh-resource://file/session/s/tmp/a.md'), true)
    assert.equal(preview.canOpen('dsh-resource://file/absolute/tmp/a.md'), false, 'an address without a session must not be claimed')
  })

  check('it registers the tree page tab', () => {
    assert.ok(tabTypes.some((entry) => entry.kind === 'md-preview-tree'), 'the tree tab type is missing')
  })

  check('it registers a body for each tab type', () => {
    const keys = registrations.filter((entry) => entry.call === 'register').map((entry) => entry.key)
    assert.ok(keys.includes('dsh-md-preview/markdown'), `bodies: ${JSON.stringify(keys)}`)
    assert.ok(keys.includes('dsh-md-preview/tree'), `bodies: ${JSON.stringify(keys)}`)
    for (const entry of registrations.filter((row) => row.call === 'register')) {
      assert.equal(typeof entry.component, 'function', `body ${entry.key} has no component`)
    }
  })

  check('it registers the header button next to the memory button', () => {
    const button = registrations.find((entry) => entry.call === 'register' && entry.name === 'conversation.session.header.utilities')
    assert.notEqual(button, undefined, `registrations: ${JSON.stringify(registrations.map((r) => r.name))}`)
    assert.equal(button.id, 'dsh-md-preview')
    assert.ok(button.order >= 0, 'the memory button sits at -1; the paperclip must not collide with it')
  })

  check('it injects its stylesheets', () => {
    assert.ok(document.head.querySelectorAll('style').length >= 2, 'panel and theme styles were not injected')
  })

  check('the header button renders a paperclip', () => {
    const { component } = registrations.find((entry) => entry.call === 'register' && entry.name === 'conversation.session.header.utilities')
    // The registered body is a one-line wrapper around the button component, so
    // call it once to reach <HeaderButton/>, then once more for its markup —
    // react-dom is not among the host's packages, and an element tree is enough
    // to catch a component that throws when rendered.
    const wrapper = component({})
    const element = wrapper.type(wrapper.props)
    assert.equal(element.type, 'button', 'the button is not a <button>')
    assert.equal(element.props['aria-label'], 'Markdown 文件树')
    const icon = element.props.children
    assert.equal(icon.props.name, 'paperclip', `icon: ${JSON.stringify(icon.props)}`)
    const svg = icon.type(icon.props)
    assert.equal(svg.type, 'svg')
    assert.ok(svg.props.children.props.d.length > 0, 'the icon path is empty')
  })
}

// 2. The declared services are what makes `apply` run at all: cordis waits for
//    them, so a profile without sidebar-right simply never applies this plugin —
//    and the "no tab type is registered" throw on click cannot happen.
check('the entry declares every service its registration depends on', () => {
  for (const name of ['slots', 'sidebarRight', 'sidebarRightTabs']) {
    assert.ok(exported.inject.includes(name), `inject is missing "${name}"`)
  }
})

// 3. A context that somehow lacks them must not take the shell down with it.
{
  const { context } = makeContext({})
  check('apply stays inert instead of throwing without the sidebar services', () => {
    assert.doesNotThrow(() => exported.apply(context))
  })
}

// 4. The float request reaches the host API with the tab id — and refuses
//    nonsense instead of calling into the sidebar with it.
check('a float request goes to sidebarRight.float with the tab id', () => {
  const calls = []
  const sidebar = { float: (tabId) => calls.push(tabId) }
  assert.equal(exported.requestFloat(sidebar, 'tab-7'), true)
  assert.deepEqual(calls, ['tab-7'])
  assert.equal(exported.requestFloat(sidebar, ''), false, 'an empty tab id must not be sent')
  assert.deepEqual(calls, ['tab-7'], 'nothing was sent for the empty id')
  assert.equal(exported.requestFloat({}, 'tab-7'), false, 'a sidebar without float must be tolerated')
  assert.equal(
    exported.requestFloat({ float: () => { throw new Error('nope') } }, 'tab-7'),
    false,
    'a throwing float must not escape',
  )
})

// 5. The opening rectangle is real geometry inside the viewport, and it is what
//    reaches the host — the API's own default is a cascade that opens panels
//    low and to the left, over the conversation.
check('opening geometry is handed to the host and stays on screen', () => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 480 }, { width: 420, height: 380 }]) {
    const rect = exported.defaultFloatRect(viewport)
    assert.deepEqual(Object.keys(rect).sort(), ['height', 'width', 'x', 'y'])
    assert.ok(rect.x >= 0 && rect.y >= 0, `negative origin: ${JSON.stringify(rect)}`)
    assert.ok(rect.width > 0 && rect.height > 0, `non-positive size: ${JSON.stringify(rect)}`)
    assert.ok(
      rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height,
      `rect escapes the viewport: ${JSON.stringify(rect)}`,
    )
  }

  const calls = []
  const rect = exported.defaultFloatRect({ width: 1280, height: 800 })
  assert.equal(exported.requestFloat({ float: (tabId, given) => calls.push([tabId, given]) }, 'tab-9', rect), true)
  assert.deepEqual(calls, [['tab-9', rect]], 'the rectangle was not forwarded')
})

// 6. Opening a panel folds back the docked column we caused to expand — and
//    leaves a column the user already had open exactly as it was.
check('openFloating folds back only the column it expanded', () => {
  const calls = []
  const wasClosed = { isExpanded: () => false, toggleExpanded: () => calls.push('toggle') }
  exported.openFloating(wasClosed, () => calls.push('open'))
  assert.deepEqual(calls, ['open', 'toggle'], 'the column we expanded must be folded back')

  const alreadyOpen = []
  const wasOpen = { isExpanded: () => true, toggleExpanded: () => alreadyOpen.push('toggle') }
  exported.openFloating(wasOpen, () => alreadyOpen.push('open'))
  assert.deepEqual(alreadyOpen, ['open'], 'a column the user had open must be left alone')
})

// 7. Both faces open in the same place — the outline is the only thing that
//    lives on the left, and it lives inside the panel, not as a window.
check('opening geometry is one anchored rectangle inside the viewport', () => {
  const viewport = { width: 1280, height: 800 }
  const rect = exported.defaultFloatRect(viewport)
  // Anchored to the right edge — which the panel now crosses the midline to do:
  // a document plus the 260px tree column does not fit in half a screen, so the
  // property worth pinning is the right margin, not "the panel stays right of
  // centre".
  assert.ok(viewport.width - (rect.x + rect.width) <= 40, `the panel is not flush with the right edge: ${JSON.stringify(rect)}`)
  assert.ok(rect.x + rect.width <= viewport.width, 'the panel escapes the viewport')
  assert.ok(rect.width < 760 && rect.height > 300, `unexpected panel proportions: ${JSON.stringify(rect)}`)
})

// 8. It has to be wide enough to hold a document next to the tree or outline
//    column; at the old 560px cap the text column came out around 300px.
check('the panel opens wide enough for a document plus a side column', () => {
  const rect = exported.defaultFloatRect({ width: 1280, height: 800 })
  assert.ok(rect.width >= 640, `the panel is too narrow for its own columns: ${JSON.stringify(rect)}`)
  // ...but it must still shrink on a small screen instead of overflowing.
  const small = exported.defaultFloatRect({ width: 640, height: 480 })
  assert.ok(small.width < rect.width && small.x >= 0, `the panel does not shrink: ${JSON.stringify(small)}`)
})

// 8. Docking the panel back into the right column is a host call too (the
//    floating layer's own control does not do it in our case).
check('a dock request goes to sidebarRight.dock with the pane id', () => {
  const calls = []
  const sidebar = { dock: (paneId) => calls.push(paneId) }
  assert.equal(exported.requestDock(sidebar, 'pane-3'), true)
  assert.deepEqual(calls, ['pane-3'])
  assert.equal(exported.requestDock(sidebar, ''), false, 'an empty pane id must not be sent')
  assert.deepEqual(calls, ['pane-3'], 'nothing was sent for the empty pane id')
  assert.equal(exported.requestDock({}, 'pane-3'), false, 'a sidebar without dock must be tolerated')
})

// 9. Every preview theme must resolve to a Shiki palette that is actually
//    installed — a mapping to a theme that does not exist would silently drop
//    highlighting for that theme.
check('every preview theme maps to an installed Shiki theme', async () => {
  const { THEMES } = await import('../src/client/colamd.generated.js')
  const manifest = JSON.parse(await readFile(join(root, 'node_modules/@shikijs/themes/package.json'), 'utf8'))
  const available = new Set(Object.keys(manifest.exports).map((key) => key.replace('./', '')))
  const used = new Set()
  for (const theme of THEMES) {
    const name = exported.shikiThemeFor(theme.id, theme.dark)
    assert.ok(available.has(name), `${theme.id} maps to "${name}", which @shikijs/themes does not provide`)
    used.add(name)
  }
  assert.ok(used.size > 2, `the mapping collapsed to ${used.size} palette(s): ${[...used].join(', ')}`)
  assert.equal(exported.shikiThemeFor('never-heard-of-it', true), 'github-dark')
  assert.equal(exported.shikiThemeFor('never-heard-of-it', false), 'github-light')
})

// The back-to-top button cannot be rendered here (no react-dom), so its one piece
// of real logic is asserted directly: scroll the panel to the top, and never throw
// when there is no panel yet.
check('back-to-top scrolls the panel, and tolerates a missing one', () => {
  const calls = []
  exported.scrollToTop({ scrollTo: (options) => calls.push(options) })
  assert.equal(calls.length, 1, 'the panel was not scrolled')
  assert.equal(calls[0].top, 0, `scrolled to ${calls[0].top} instead of the top`)
  assert.ok(['smooth', 'auto'].includes(calls[0].behavior), `behavior: ${calls[0].behavior}`)
  exported.scrollToTop(null)
})

// VuePress shows its button 100px down and reads the ring off the same metrics,
// so the threshold and the progress maths are worth pinning down.
check('back-to-top waits for the VuePress threshold, then reports progress', () => {
  const metrics = (scrollTop, scrollHeight = 1000, clientHeight = 400) => ({ scrollTop, scrollHeight, clientHeight })
  assert.equal(exported.scrollProgress(metrics(50)), null, 'shown before the reader is 100px down')
  assert.equal(exported.scrollProgress(metrics(100)), null, 'shown exactly at the threshold')
  assert.equal(exported.scrollProgress(metrics(250)), 250 / 600, 'progress is not scrollTop over the scrollable distance')
  assert.equal(exported.scrollProgress(metrics(600)), 1, 'the end of the document is not full progress')
  assert.equal(exported.scrollProgress(metrics(200, 400, 400)), null, 'a document with nothing to scroll')
  assert.equal(exported.scrollProgress(metrics(900, 10, 1000)), null, 'a wrong measurement should not paint a ring')
})

const failed = await Promise.all(pending).then(() => results.filter(([ok]) => !ok))
for (const [ok, name] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
