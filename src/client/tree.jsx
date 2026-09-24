/**
 * The markdown file tree: the session workspace plus every skill root.
 *
 * Levels load on expansion and are kept until the tree unmounts — the host
 * already filters each level down to markdown files and to directories that
 * contain markdown, so nothing here has to know about ignore lists. Selecting a
 * file is a single click: no double-click, no pinning.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { documentName } from './address.js'
import { fetchTree } from './api.js'
import { Icon } from './icons.jsx'
import { useRecent } from './recent.js'

/**
 * @param props.sessionId - session whose workspace is browsed.
 * @param props.roots - root descriptors from the host (`{id,label,path,exists}`).
 * @param props.selectedPath - absolute path of the open document.
 * @param props.onOpen - called with `{ path, rootId }` when a file is chosen.
 * @param props.refreshToken - bumped when the workspace root changed; re-reads
 *   the first level of every root and leaves expanded subdirectories alone.
 */
export function FileTree({ sessionId, roots, selectedPath, onOpen, refreshToken = 0 }) {
  const [levels, setLevels] = useState(() => new Map())
  const [expanded, setExpanded] = useState(() => new Set())
  const recent = useRecent(sessionId)

  const load = useCallback(async (rootId, path) => {
    setLevels((previous) => new Map(previous).set(path, { status: 'loading' }))
    try {
      const listing = await fetchTree(sessionId, rootId, path)
      setLevels((previous) => new Map(previous).set(path, { status: 'ready', entries: listing.entries }))
    } catch (error) {
      setLevels((previous) => new Map(previous).set(path, { status: 'failed', message: error.message }))
    }
  }, [sessionId])

  // Roots are open by definition, so their first level is fetched eagerly.
  const visible = roots.filter((root) => root.exists === true)
  const signature = visible.map((root) => root.path).join('\n')
  useEffect(() => {
    setLevels(new Map())
    setExpanded(new Set())
    for (const root of visible) load(root.id, root.path)
    // `visible` is derived from `roots`, which the panel re-reads on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, sessionId])

  // The workspace root is watched, so files appearing or leaving show up on
  // their own; expanded subdirectories are refreshed only on demand.
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useEffect(() => {
    if (refreshToken === 0) return
    for (const root of visibleRef.current) load(root.id, root.path)
  }, [refreshToken, load])

  const toggle = (rootId, path) => {    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (!levels.has(path)) load(rootId, path)
  }

  return (
    <div className="mdp-tree" role="tree" aria-label="Markdown 文件">
      {recent.length > 0 ? (
        <>
          <div className="mdp-group">最近打开</div>
          {recent.map((entry) => (
            <button
              key={entry.path}
              type="button"
              role="treeitem"
              aria-selected={selectedPath === entry.path}
              className="mdp-row"
              style={{ paddingLeft: 8 }}
              title={entry.path}
              onClick={() => onOpen({ path: entry.path })}
            >
              <Icon name="file" size={14} />
              <span className="mdp-row-label">{documentName(entry.path)}</span>
            </button>
          ))}
        </>
      ) : null}
      {visible.length === 0 ? <div className="mdp-tree-empty">没有可浏览的目录</div> : null}
      {visible.map((root) => (
        <Fragment key={root.id}>
          <div className="mdp-group">{root.label}</div>
          <Level
            path={root.path}
            rootId={root.id}
            depth={0}
            levels={levels}
            expanded={expanded}
            toggle={toggle}
            selectedPath={selectedPath}
            onOpen={onOpen}
          />
        </Fragment>
      ))}
    </div>
  )
}

/** One directory level, recursing into the directories the user expanded. */
function Level({ path, rootId, depth, levels, expanded, toggle, selectedPath, onOpen }) {
  const level = levels.get(path)
  if (level === undefined || level.status === 'loading') return null
  if (level.status === 'failed') return <div className="mdp-tree-empty">{level.message}</div>
  if (level.entries.length === 0) {
    return depth === 0 ? <div className="mdp-tree-empty">没有 markdown 文件</div> : null
  }
  const indent = 8 + depth * 12
  return (
    <>
      {level.entries.map((entry) => entry.kind === 'directory' ? (
        <Fragment key={entry.path}>
          <button
            type="button"
            role="treeitem"
            aria-expanded={expanded.has(entry.path)}
            className="mdp-row"
            style={{ paddingLeft: indent }}
            onClick={() => toggle(rootId, entry.path)}
          >
            <span className={expanded.has(entry.path) ? 'mdp-twisty mdp-twisty-open' : 'mdp-twisty'}>
              <Icon name="chevron" size={12} />
            </span>
            <Icon name="folder" size={14} />
            <span className="mdp-row-label">{entry.name}</span>
          </button>
          {expanded.has(entry.path) ? (
            <Level
              path={entry.path}
              rootId={rootId}
              depth={depth + 1}
              levels={levels}
              expanded={expanded}
              toggle={toggle}
              selectedPath={selectedPath}
              onOpen={onOpen}
            />
          ) : null}
        </Fragment>
      ) : (
        <button
          key={entry.path}
          type="button"
          role="treeitem"
          aria-selected={selectedPath === entry.path}
          className="mdp-row"
          style={{ paddingLeft: indent + 18 }}
          onClick={() => onOpen({ path: entry.path, rootId })}
        >
          <Icon name="file" size={14} />
          <span className="mdp-row-label">{entry.name}</span>
        </button>
      ))}
    </>
  )
}
