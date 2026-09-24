/**
 * The two right-sidebar tab bodies.
 *
 * `PreviewPanel` owns one markdown document: it reads it, renders it, watches it
 * for outside changes, and can hand it to the CodeMirror editor. `TreePanel` is
 * the browser face the header button opens — picking a file there opens the
 * preview tab and closes the tree, so the tree never competes for space with
 * the document it opened.
 *
 * Both are official sidebar-right tabs, so docking, floating, width dragging and
 * the tab strip come from the shell rather than from this plugin.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDocument, fetchRoots, saveDocument, useFileWatch } from './api.js'
import { documentAddress, documentName, parseDocumentAddress } from './address.js'
import { MarkdownEditor } from './editor.jsx'
import { FileTree } from './tree.jsx'
import { Icon } from './icons.jsx'
import { renderMarkdown } from './markdown.js'
import { renderMermaid } from './mermaid.js'
import { openFloating, requestDock, useFloatOnOpen } from './float.js'
import { recordRecent } from './recent.js'
import { THEMES, isDarkTheme, resolveTheme, useShellDark, useThemePreference } from './theme.js'

/** How long a notice stays on screen before it hides itself. */
const NOTE_AUTO_HIDE_MS = 3000

/** The roots of the current session, re-read on demand. */
function useRoots(sessionId) {
  const [roots, setRoots] = useState([])
  const reload = useCallback(() => {
    if (sessionId === undefined) {
      console.warn('[dsh-md-preview] this tab carries no session id — the file tree cannot load')
      return
    }
    fetchRoots(sessionId).then(setRoots, () => setRoots([]))
  }, [sessionId])
  useEffect(() => { reload() }, [reload])
  return [roots, reload]
}

/**
 * Refresh token for the file tree.
 *
 * Only the workspace root is probed, so files appearing or leaving show up by
 * themselves; expanded subdirectories are left to the user's refresh button.
 * The skill roots are not watched at all — a skill document is re-read only
 * while it is actually open in a preview tab (the document watch below).
 */
function useWorkspaceTree(sessionId, roots) {
  const [token, setToken] = useState(0)
  const workspaceRoot = roots.find((root) => root.id === 'workspace')?.path
  const paths = workspaceRoot === undefined ? [] : [workspaceRoot]
  useFileWatch(sessionId, paths, () => setToken((value) => value + 1))
  return token
}

/** VuePress's back-to-top threshold: it appears once the reader is 100px down. */
const BACK_TO_TOP_THRESHOLD = 100
/** Radius of the progress ring inside the 44px button (viewBox 0 0 44 44). */
const RING_RADIUS = 20
/** That ring's circumference, the length stroke-dasharray is measured against. */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * How far through the document the reader is — VuePress pairs its button with
 * this, drawing the ring so the button doubles as a reading-progress indicator.
 * @param metrics - the scroller's scrollTop / scrollHeight / clientHeight.
 * @returns 0..1, or null while the button should stay hidden (not yet past the
 *   threshold, or a document with nothing to scroll).
 */
export function scrollProgress({ scrollTop, scrollHeight, clientHeight }) {
  if (!(scrollTop > BACK_TO_TOP_THRESHOLD)) return null
  const scrollable = scrollHeight - clientHeight
  if (!(scrollable > 0)) return null
  return Math.min(1, Math.max(0, scrollTop / scrollable))
}

/** Back to top, the way VuePress docs do it: smooth unless motion is reduced. */
export function scrollToTop(container) {
  if (container === null) return
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  container.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
}

/** Scroll to a heading inside the rendered document. */
function scrollToHeading(container, id) {
  if (container === null || id === '') return
  const target = container.querySelector(`[id="${CSS.escape(id)}"]`)
  if (target !== null) target.scrollIntoView({ block: 'start' })
}

/**
 * One markdown document: preview, outline, theme, refresh and editing.
 * @param props.sidebar - the `sidebarRight` service, passed in by the
 *   registration site: reading it off the context here would be an undeclared
 *   property access, which cordis refuses.
 * @param props.useTabInfo - framework hook returning `{ sidebar, panel, tab }`.
 */
export function PreviewPanel({ sessionId, sidebar, useTabInfo }) {
  const { tab, panel } = useTabInfo()
  const path = parseDocumentAddress(tab?.contentId)?.path
  useFloatOnOpen(sidebar, tab?.id)

  const [roots, reloadRoots] = useRoots(sessionId)
  const treeToken = useWorkspaceTree(sessionId, roots)
  const [doc, setDoc] = useState(undefined)
  const [html, setHtml] = useState('')
  const [headings, setHeadings] = useState([])
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [editing, setEditing] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [themeMenu, setThemeMenu] = useState(false)
  const [note, setNote] = useState(undefined)
  const [noteCollapsed, setNoteCollapsed] = useState(false)
  const [progress, setProgress] = useState(null)
  const [preference, setPreference] = useThemePreference()
  const shellDark = useShellDark()
  const themeId = resolveTheme(preference, shellDark)
  const darkTheme = isDarkTheme(themeId)
  const scrollRef = useRef(null)

  /** Read the document (and, on request, keep the reader where they were). */
  const read = useCallback(async (keepScroll) => {
    if (sessionId === undefined || path === undefined) return
    const previousScroll = keepScroll === true ? (scrollRef.current?.scrollTop ?? 0) : 0
    try {
      const file = await fetchDocument(sessionId, path)
      setDoc(file)
      setDraft(file.text)
      setDirty(false)
      setNote(undefined)
      // A newly opened document starts at its top, so the button leaves with the
      // one before it — no scroll event will fire to say so.
      if (keepScroll !== true) setProgress(null)
      recordRecent(sessionId, file.path)
      if (keepScroll === true) {
        requestAnimationFrame(() => {
          if (scrollRef.current !== null) scrollRef.current.scrollTop = previousScroll
        })
      }
    } catch (error) {
      setNote({ kind: 'error', text: `读取失败：${error.message}` })
    }
  }, [sessionId, path])

  // New target: load it.
  useEffect(() => {
    setDoc(undefined)
    setHtml('')
    setHeadings([])
    setDirty(false)
    setEditing(false)
    setNote(undefined)
    read(false)
  }, [read])

  // Render whenever the text or the theme changes — but not while editing, where
  // the source is being worked on and a re-render would only be discarded. The
  // dependency has to be the theme *id*, not its luminance: picking another theme
  // of the same lightness changes the Shiki palette without touching darkTheme,
  // so keying on darkTheme alone left the old palette's inline colours in place
  // (the stylesheet switched, the code blocks did not).
  useEffect(() => {
    if (doc === undefined || editing) return undefined
    let cancelled = false
    renderMarkdown(doc.text, {
      sessionId,
      docPath: doc.path,
      // The theme id drives both the stylesheet class and the code palette.
      theme: themeId,
      dark: darkTheme,
    }).then((rendered) => {
      if (cancelled) return
      setHtml(rendered.html)
      setHeadings(rendered.headings)
    }, (error) => {
      if (!cancelled) setNote({ kind: 'error', text: `渲染失败：${error.message}` })
    })
    return () => { cancelled = true }
  }, [doc, editing, themeId, darkTheme, sessionId])

  // A notice hides itself after a moment so it never squats on the document.
  // One that carries a decision leaves a toolbar marker behind: hiding the
  // button that says "the file changed under you" outright would invite
  // overwriting the agent's edit by accident.
  useEffect(() => {
    if (note === undefined) return undefined
    setNoteCollapsed(false)
    const timer = setTimeout(() => setNoteCollapsed(true), NOTE_AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [note])

  const save = useCallback(async (force) => {
    if (sessionId === undefined || doc === undefined) return
    try {
      const result = await saveDocument(sessionId, doc.path, draft, force === true ? undefined : doc.mtimeMs)
      setDoc((previous) => (previous === undefined ? previous : { ...previous, mtimeMs: result.mtimeMs, size: result.size, text: draft }))
      setDirty(false)
      setNote({ kind: 'info', text: '已保存' })
    } catch (error) {
      if (error.code === 'conflict') {
        setNote({
          kind: 'error',
          text: '文件已在磁盘上变化，保存被拒绝',
          action: { label: '强制覆盖', run: () => save(true) },
        })
      } else {
        setNote({ kind: 'error', text: `保存失败：${error.message}` })
      }
    }
  }, [sessionId, doc, draft])

  const onChanged = useCallback((entries) => {
    const entry = entries[0]
    if (entry === undefined) return
    if (entry.exists === false) {
      setNote({ kind: 'error', text: '文件已从磁盘上删除' })
      return
    }
    if (dirty) {
      setNote({ kind: 'info', text: '文件已在磁盘上被修改', action: { label: '重新加载', run: () => read(true) } })
      return
    }
    read(true)
  }, [dirty, read])

  const watched = doc === undefined ? [] : [doc.path]
  useFileWatch(sessionId, watched, onChanged)

  // Render Mermaid diagrams on demand; failures keep the source visible.
  useEffect(() => {
    const container = scrollRef.current
    if (container === null || html === '') return undefined
    let cancelled = false
    for (const stale of container.querySelectorAll('.mdp-mermaid[data-mermaid-rendered]')) {
      stale.querySelector('svg')?.remove()
      stale.querySelector('.mdp-mermaid-error')?.remove()
      delete stale.dataset.mermaidRendered
    }
    for (const block of container.querySelectorAll('.mdp-mermaid')) {
      const source = decodeURIComponent(block.getAttribute('data-mermaid-source') ?? '')
      if (source === '') continue
      block.dataset.mermaidRendered = 'pending'
      renderMermaid(source, darkTheme ? 'dark' : 'light').then((svg) => {
        if (cancelled) return
        block.dataset.mermaidRendered = 'true'
        block.insertAdjacentHTML('beforeend', svg)
      }, (error) => {
        if (cancelled) return
        block.dataset.mermaidRendered = 'failed'
        const failure = document.createElement('div')
        failure.className = 'mdp-mermaid-error'
        failure.textContent = `图表渲染失败：${error.message}`
        block.append(failure)
      })
    }
    return () => { cancelled = true }
  }, [html, darkTheme])

  /** Open a markdown file the document links to, in its own preview tab. */
  const onDocumentClick = (event) => {
    const anchor = event.target.closest?.('a[data-mdp-doc]')
    if (anchor === null || anchor === undefined) return
    const linked = decodeURIComponent(anchor.getAttribute('data-mdp-doc') ?? '')
    if (linked === '' || sessionId === undefined) return
    event.preventDefault()
    // Every open expands the docked column; fold it back when we caused that.
    openFloating(sidebar, () => sidebar.openResource(documentAddress(sessionId, linked)))
  }

  /** Offer back-to-top, and its reading-progress ring, once the reader is in. */
  const onScroll = (event) => {
    const container = event.currentTarget
    setProgress(scrollProgress({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    }))
  }

  const topVisible = !editing && progress !== null
  const name = path === undefined ? 'Markdown 预览' : documentName(path)

  return (
    <div className="mdp-root">
      <div className="mdp-toolbar">
        <button
          type="button"
          className="mdp-btn"
          aria-pressed={treeOpen}
          title="文件树"
          onClick={() => setTreeOpen((open) => !open)}
        >
          <Icon name="tree" />
        </button>
        <button type="button" className="mdp-btn" title="刷新" onClick={() => { read(true); reloadRoots() }}>
          <Icon name="refresh" />
        </button>
        <button
          type="button"
          className="mdp-btn"
          aria-pressed={editing}
          title={editing ? '预览' : '编辑'}
          onClick={() => setEditing((on) => !on)}
        >
          <Icon name={editing ? 'eye' : 'edit'} />
        </button>
        {editing ? (
          <button type="button" className="mdp-btn" title="保存 (Ctrl+S)" onClick={() => save(false)}>
            <Icon name="save" />
          </button>
        ) : null}
        <button
          type="button"
          className="mdp-btn"
          aria-pressed={outlineOpen}
          title="大纲"
          onClick={() => setOutlineOpen((open) => !open)}
          disabled={headings.length === 0}
        >
          <Icon name="outline" />
        </button>
        <button
          type="button"
          className="mdp-btn"
          aria-pressed={themeMenu}
          title="主题"
          onClick={() => setThemeMenu((open) => !open)}
        >
          <Icon name="palette" />
        </button>
        {/* The floating layer's own control does not dock this panel, so the
            panel carries its own way back into the right column. */}
        <button
          type="button"
          className="mdp-btn"
          title="收回右侧栏"
          aria-label="收回右侧栏"
          onClick={() => requestDock(sidebar, panel?.id)}
        >
          <Icon name="dock" />
        </button>
        {dirty ? <span className="mdp-dirty" title="有未保存的修改" /> : null}
        {note?.action !== undefined && noteCollapsed ? (
          <button
            type="button"
            className="mdp-btn mdp-btn-alert"
            title={note.text}
            aria-label={note.text}
            onClick={() => setNoteCollapsed(false)}
          >
            <Icon name="alert" />
          </button>
        ) : null}
        <span className="mdp-label" title={path ?? ''}>{name}</span>
      </div>

      {themeMenu ? (
        <div className="mdp-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="mdp-menu-item"
            aria-current={preference === 'auto'}
            onClick={() => { setPreference('auto'); setThemeMenu(false) }}
          >
            跟随宿主（{shellDark ? '深色' : '浅色'}）
          </button>
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="menuitem"
              className="mdp-menu-item"
              aria-current={preference === theme.id}
              onClick={() => { setPreference(theme.id); setThemeMenu(false) }}
            >
              {theme.label}
            </button>
          ))}
        </div>
      ) : null}

      {note !== undefined && !noteCollapsed ? (
        <div className={note.kind === 'error' ? 'mdp-note mdp-note-error' : 'mdp-note'}>
          <span className="mdp-row-label">{note.text}</span>
          {note.action !== undefined ? (
            <button type="button" onClick={note.action.run}>{note.action.label}</button>
          ) : (
            <button type="button" onClick={() => setNote(undefined)}>关闭</button>
          )}
        </div>
      ) : null}

      <div className="mdp-body">
        <div className={treeOpen ? undefined : 'mdp-tree-collapsed'} style={treeOpen ? undefined : { display: 'none' }}>
          <FileTree
            sessionId={sessionId}
            roots={roots}
            selectedPath={path}
            refreshToken={treeToken}
            onOpen={(entry) => {
              if (sessionId === undefined) return
              openFloating(sidebar, () => sidebar.openResource(documentAddress(sessionId, entry.path)))
            }}
          />
        </div>
        {outlineOpen && headings.length > 0 ? (
          <div className="mdp-outline" aria-label="文档大纲">
            <div className="mdp-group">大纲</div>
            {headings.map((heading, index) => (
              <button
                key={`${heading.id}-${index}`}
                type="button"
                className="mdp-outline-item"
                style={{ paddingLeft: 10 + (heading.level - 1) * 12 }}
                onClick={() => scrollToHeading(scrollRef.current, heading.id)}
              >
                {heading.title === '' ? '(无标题)' : heading.title}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mdp-doc">
          {editing ? (
            <MarkdownEditor
              value={draft}
              onChange={(text) => { setDraft(text); setDirty(text !== doc?.text) }}
              onSave={() => save(false)}
            />
          ) : (
            <div className={`mdp-scroll mdp-md theme-${themeId}`} ref={scrollRef} onClick={onDocumentClick} onScroll={onScroll}>
              {doc === undefined && note === undefined
                ? <div className="mdp-empty">正在读取…</div>
                : <div dangerouslySetInnerHTML={{ __html: html }} />}
            </div>
          )}
          <button
            type="button"
            className="mdp-top"
            data-visible={topVisible ? 'true' : 'false'}
            title="回到顶部"
            aria-label="回到顶部"
            tabIndex={topVisible ? 0 : -1}
            onClick={() => scrollToTop(scrollRef.current)}
          >
            <svg className="mdp-top-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
              <circle className="mdp-top-track" cx="22" cy="22" r={RING_RADIUS} />
              <circle
                className="mdp-top-progress"
                cx="22"
                cy="22"
                r={RING_RADIUS}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - (progress ?? 0))}
              />
            </svg>
            <Icon name="arrowUp" />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The tree face: browse, pick a file, close.
 * @param props.sidebar - the `sidebarRight` service (see PreviewPanel).
 */
export function TreePanel({ sessionId, sidebar, useTabInfo }) {
  const { tab, panel } = useTabInfo()
  // Both faces open in the same place; only the outline lives on the left.
  useFloatOnOpen(sidebar, tab?.id)
  const [roots, reload] = useRoots(sessionId)
  const treeToken = useWorkspaceTree(sessionId, roots)

  return (
    <div className="mdp-root">
      <div className="mdp-toolbar">
        <button type="button" className="mdp-btn" title="刷新" onClick={reload}>
          <Icon name="refresh" />
        </button>
        <span className="mdp-label">Markdown 文件树</span>
        <button
          type="button"
          className="mdp-btn"
          title="收回右侧栏"
          aria-label="收回右侧栏"
          onClick={() => requestDock(sidebar, panel?.id)}
        >
          <Icon name="dock" />
        </button>
        <button type="button" className="mdp-btn" title="关闭" onClick={() => sidebar.close(tab.id)}>
          <Icon name="close" />
        </button>
      </div>
      <div className="mdp-body">
        <FileTree
          sessionId={sessionId}
          roots={roots}
          refreshToken={treeToken}
          onOpen={(entry) => {
            if (sessionId === undefined) return
            // The preview takes focus; the tree has done its job and folds away.
            openFloating(sidebar, () => sidebar.openResource(documentAddress(sessionId, entry.path)))
            sidebar.close(tab.id)
          }}
        />
      </div>
    </div>
  )
}
