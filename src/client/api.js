/**
 * Client side of the host's `/md-preview/api` route, plus the change feed.
 *
 * Everything the panel shows (trees, file text, versions) comes from here; the
 * host owns containment and validation, this module owns transport and the
 * "did something change" bookkeeping. Change detection is a poll over exactly
 * the paths the panel is showing — no directory watching, no whole-tree rescans
 * — because a document can be rewritten by the agent, another editor or a shell
 * command, and only a real read of the version catches all three. It watches
 * the open document and the workspace root; expanded subdirectories and the
 * skill roots are refreshed on demand instead.
 */
import { useCallback, useEffect, useRef } from 'react'

const ENDPOINT = '/md-preview/api'

/** How often the watched paths are re-checked for changes. */
export const WATCH_INTERVAL_MS = 3000

/** Largest number of files one probe may carry (the host enforces the same). */
export const MAX_WATCH_FILES = 300

/** Failure carrying the host's stable code, so callers branch on it. */
export class PreviewRequestError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function call(method, payload) {
  let response
  try {
    response = await fetch(`${ENDPOINT}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new PreviewRequestError('offline', `preview API unreachable: ${error.message}`, 0)
  }
  const body = await response.json().catch(() => undefined)
  if (!response.ok || body?.ok !== true) {
    throw new PreviewRequestError(
      body?.error?.code ?? 'internal',
      body?.error?.message ?? `request failed (HTTP ${response.status})`,
      response.status,
    )
  }
  return body.value
}

/** The roots the panel may browse: the session workspace, then the skill roots. */
export function fetchRoots(sessionId) {
  return call('roots', { sessionId })
}

/** One directory level of a root (markdown files, plus directories holding md). */
export function fetchTree(sessionId, rootId, path) {
  return call('tree', { sessionId, rootId, path })
}

/** One markdown document with the version its text was read at. */
export function fetchDocument(sessionId, path) {
  return call('read', { sessionId, path })
}

/**
 * Save a document. `mtimeMs` is the version the editor read; the host refuses
 * the write with `conflict` when the file changed since, so a save can never
 * silently discard the agent's edit.
 */
export function saveDocument(sessionId, path, text, mtimeMs) {
  return call('write', { sessionId, path, text, mtimeMs })
}

/** Version probe for the files currently on screen. */
export function probeFiles(sessionId, files) {
  return call('stat', { sessionId, files: files.slice(0, MAX_WATCH_FILES) })
}

/** URL an `<img>` in a rendered document points at. */
export function rawUrl(sessionId, path) {
  return `${ENDPOINT}/raw?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
}

/** Version string of one probe answer, comparable across polls. */
function versionOf(entry) {
  if (entry.exists !== true) return 'absent'
  if (entry.directory === true) return `dir:${entry.mtimeMs}`
  return `${entry.mtimeMs}:${entry.size}`
}

/**
 * Poll a fixed set of paths and report the ones whose version changed.
 * @param sessionId - the session whose workspace is being shown.
 * @param paths - the paths on screen (the open document, and the workspace root).
 * @param onChanged - called with the changed entries; kept in a ref so a caller
 *   does not have to memoise it.
 * @param enabled - false suspends the poll (used while a tab is hidden).
 */
export function useFileWatch(sessionId, paths, onChanged, enabled = true) {
  const handler = useRef(onChanged)
  handler.current = onChanged
  const signature = paths.join('\n')
  const clear = useCallback(() => { /* placeholder for effect symmetry */ }, [])

  useEffect(() => {
    if (enabled !== true || sessionId === undefined || signature === '') return undefined
    const watched = signature.split('\n')
    const known = new Map()
    let stopped = false
    let timer

    const tick = async () => {
      const entries = await probeFiles(sessionId, watched).catch(() => undefined)
      if (stopped || entries === undefined) return
      const changed = []
      for (const entry of entries) {
        const current = versionOf(entry)
        const previous = known.get(entry.path)
        known.set(entry.path, current)
        if (previous !== undefined && previous !== current) changed.push(entry)
      }
      if (changed.length > 0) handler.current(changed)
    }

    tick().then(() => {
      if (!stopped) timer = setInterval(tick, WATCH_INTERVAL_MS)
    })
    return () => {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [sessionId, signature, enabled])

  return clear
}
