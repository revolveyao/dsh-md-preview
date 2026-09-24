/**
 * Recently opened documents, per session.
 *
 * Kept in localStorage rather than on the host: this is a reading convenience,
 * not workspace state, and it should survive a page reload without a round trip
 * or a filesystem write. Recording happens where a document is actually loaded,
 * so a file opened from a conversation reference, from the tree, or by following
 * a link all land in the same list.
 */
import { useEffect, useState } from 'react'

const PREFIX = 'dsh-md-preview.recent.'
const LIMIT = 8

/** Subscribers notified when any session's list changes. */
const listeners = new Set()

/** Most recently opened documents of one session, newest first. */
export function readRecent(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return []
  try {
    const raw = localStorage.getItem(`${PREFIX}${sessionId}`)
    const parsed = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry) => typeof entry?.path === 'string' && entry.path !== '')
  } catch {
    return []
  }
}

/** Remember one document as the most recent of its session. */
export function recordRecent(sessionId, path) {
  if (typeof sessionId !== 'string' || sessionId === '' || typeof path !== 'string' || path === '') return
  const entries = readRecent(sessionId).filter((entry) => entry.path !== path)
  entries.unshift({ path, at: Date.now() })
  try {
    localStorage.setItem(`${PREFIX}${sessionId}`, JSON.stringify(entries.slice(0, LIMIT)))
  } catch {
    /* a blocked storage only means the list is not remembered */
  }
  for (const listener of listeners) listener(sessionId)
}

/** The recent list of one session, kept in sync while it is on screen. */
export function useRecent(sessionId) {
  const [entries, setEntries] = useState(() => readRecent(sessionId))
  useEffect(() => {
    setEntries(readRecent(sessionId))
    const listener = (changed) => {
      if (changed === sessionId) setEntries(readRecent(sessionId))
    }
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [sessionId])
  return entries
}
