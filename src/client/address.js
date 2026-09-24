/**
 * Document addresses.
 *
 * The right sidebar identifies a tab by its content id, a `dsh-resource://`
 * URI. Registering our tab type against `*.md` is what makes a click on a
 * markdown reference in the conversation land in this preview, and that path
 * hands the body an address rather than a path — so the address is parsed back
 * here. The workspace-files service documents the shape as
 * `dsh-resource://file/session/<sessionId>/<path>`, where `<path>` may be
 * relative or absolute; the leading slash of an absolute path is kept (their
 * own example is `.../session/s//etc/hosts`).
 */

const PREFIX = 'dsh-resource://file/session/'

/** Absolute or workspace-relative path of a document, as forward slashes. */
function toUriPath(path) {
  return path.replace(/\\/g, '/')
}

/**
 * Address for one document in one session.
 * @param sessionId - the session whose workspace holds the file.
 * @param path - absolute or workspace-relative path.
 */
export function documentAddress(sessionId, path) {
  return `${PREFIX}${encodeURIComponent(sessionId)}/${encodeURI(toUriPath(path))}`
}

/**
 * Parse an address back into `{ sessionId, path }`.
 * @returns undefined for an address this preview did not author (the panel then
 *   shows its empty state instead of guessing).
 */
export function parseDocumentAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(PREFIX)) return undefined
  const rest = address.slice(PREFIX.length)
  const separator = rest.indexOf('/')
  if (separator <= 0) return undefined
  const sessionId = decodeURIComponent(rest.slice(0, separator))
  const raw = rest.slice(separator + 1)
  if (raw === '') return undefined
  let path
  try {
    path = decodeURI(raw)
  } catch {
    return undefined
  }
  if (sessionId === '' || path === '') return undefined
  return { sessionId, path }
}

/** Display name of a document: its last path segment. */
export function documentName(path) {
  const normalized = toUriPath(path).replace(/\/+$/, '')
  const separator = normalized.lastIndexOf('/')
  return separator === -1 ? normalized : normalized.slice(separator + 1)
}

/** The directory part of a document path (used for its outline/relative refs). */
export function documentDirectory(path) {
  const normalized = toUriPath(path)
  const separator = normalized.lastIndexOf('/')
  return separator === -1 ? '' : normalized.slice(0, separator)
}
