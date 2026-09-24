/**
 * dsh-md-preview — host half.
 *
 * Serves the browser half over one same-origin prefix (`/md-preview/api`):
 * the markdown file trees (workspace + skill roots), file reads, guarded
 * writes, an image endpoint for documents that reference local images, and a
 * stat probe the client polls for change detection.
 *
 * Why a private route instead of the official workspace-files remote: that
 * service has no write path, its `list` is confined to the workspace, and its
 * `changes` feed only reports *instrumented* fs operations — a file rewritten
 * by a shell command, another editor or a subprocess produces no frame. The
 * preview must notice those, and must show skills that live outside the
 * workspace, so it owns a small route and enforces the same containment the
 * official service would.
 */
import { readFile } from 'node:fs/promises'
import { PreviewError, isWithin, listDirectory, readImageFile, readTextFile, resolveReadable, resolveWritable, skillRoots, statFiles, userMemoryRoots, writeTextFile } from './paths.js'

/** Largest JSON request body accepted, in bytes. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/**
 * Heavy browser assets served on demand instead of being bundled into
 * client.js (the loader serves one file per plugin, so a bundle would ship
 * them to every session whether or not a document uses them). Keys are the
 * only accepted names — the paths are fixed, so no request can aim them.
 */
const ASSETS = {
  katex: ['katex/dist/katex.min.js'],
  mermaid: ['mermaid/dist/mermaid.min.js', 'mermaid/dist/mermaid.esm.min.mjs'],
}

/** Header lookup that tolerates a missing headers object. */
function header(headers, name) {
  const value = headers?.[name]
  return typeof value === 'string' ? value : undefined
}

/** Parse an authority (`host:port`) into a URL, or undefined when malformed. */
function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return (trustedHosts ?? []).some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
    const canonical = port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
    return canonical === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host
  })
}

/**
 * Same-origin fence: the route reads files from disk, so a request from a
 * foreign page must never reach it. Loopback and configured trusted hosts are
 * accepted; a cross-site fetch or a foreign `Origin` is not.
 */
function isTrustedRequest(request, trustedHosts) {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}

function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

function writeFailure(res, error) {
  const status = error instanceof PreviewError ? error.status : 500
  writeJson(res, status, {
    ok: false,
    error: {
      code: error instanceof PreviewError ? error.code : 'internal',
      message: error instanceof Error ? error.message : String(error),
    },
  })
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new PreviewError('bad-request', 'request body too large', 413)
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new PreviewError('bad-request', 'request body is not valid JSON', 400)
  }
}

/** The workspace cwd of a live session, or a `not-found` failure. */
function workspaceOf(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new PreviewError('bad-request', 'sessionId is required', 400)
  }
  const store = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
  const session = typeof store?.get === 'function' ? store.get(sessionId) : undefined
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new PreviewError('not-found', `session has no workspace: ${sessionId}`, 404)
  }
  return cwd
}

/** Every root the preview may read, workspace first (it is the writable one). */
async function rootsOf(ctx, sessionId) {
  const cwd = workspaceOf(ctx, sessionId)
  const workspace = { id: 'workspace', label: '工作区', path: cwd, writable: true }
  // The user's own memory files live outside the workspace. They are writable on
  // purpose: this panel is how a human reads *and adjusts* that memory.
  const memories = userMemoryRoots().map((root) => ({ ...root, writable: true }))
  const skills = (await skillRoots(cwd)).map((root) => ({ ...root, writable: false }))
  return [workspace, ...memories, ...skills]
}

function rootOf(roots, rootId) {
  const root = roots.find((entry) => entry.id === rootId)
  if (root === undefined) throw new PreviewError('bad-request', `unknown root: ${String(rootId)}`, 400)
  return root
}

/**
 * Dispatch one API method. The route owns no session state: `stat` answers for
 * exactly the files the client names, so change detection costs one stat per
 * visible file and the host keeps no cache to invalidate.
 */
async function dispatch(ctx, method, payload) {
  switch (method) {
    case 'roots': {
      const roots = await rootsOf(ctx, payload.sessionId)
      return Promise.all(roots.map(async (root) => ({
        id: root.id,
        label: root.label,
        path: root.path,
        writable: root.writable,
        exists: await import('node:fs/promises').then(({ stat }) => stat(root.path).then((info) => info.isDirectory(), () => false)),
      })))
    }
    case 'tree': {
      const roots = await rootsOf(ctx, payload.sessionId)
      const root = rootOf(roots, payload.rootId)
      const target = typeof payload.path === 'string' && payload.path !== ''
        ? (await resolveReadable([root], payload.path)).path
        : root.path
      return listDirectory(target, { writableRoots: roots.filter((entry) => entry.writable === true).map((entry) => entry.path) })
    }
    case 'read': {
      const roots = await rootsOf(ctx, payload.sessionId)
      const { path } = await resolveReadable(roots, String(payload.path ?? ''))
      return readTextFile(path)
    }
    case 'write': {
      const roots = await rootsOf(ctx, payload.sessionId)
      const requested = String(payload.path ?? '')
      const owner = roots.find((entry) => entry.writable === true && isWithin(entry.path, requested))
      if (owner === undefined) throw new PreviewError('forbidden', 'path is outside the writable roots', 403)
      const target = await resolveWritable(owner, requested)
      const text = typeof payload.text === 'string' ? payload.text : undefined
      if (text === undefined) throw new PreviewError('bad-request', 'text is required', 400)
      const expected = typeof payload.mtimeMs === 'number' ? payload.mtimeMs : undefined
      return writeTextFile(target, text, expected)
    }
    case 'stat': {
      await rootsOf(ctx, payload.sessionId)
      const files = Array.isArray(payload.files) ? payload.files.filter((entry) => typeof entry === 'string') : []
      if (files.length > 500) throw new PreviewError('bad-request', 'too many files in one probe', 400)
      const roots = await rootsOf(ctx, payload.sessionId)
      const allowed = []
      for (const file of files) {
        const resolved = await resolveReadable(roots, file).catch(() => undefined)
        if (resolved !== undefined) allowed.push(resolved.path)
      }
      return statFiles(allowed)
    }
    default:
      throw new PreviewError('not-found', `unknown method: ${String(method)}`, 404)
  }
}

/** GET /md-preview/api/raw — serve one local image a document references. */
async function serveRaw(ctx, url, res) {
  const sessionId = url.searchParams.get('sessionId') ?? ''
  const path = url.searchParams.get('path') ?? ''
  const roots = await rootsOf(ctx, sessionId)
  const { path: resolved } = await resolveReadable(roots, path)
  const image = await readImageFile(resolved)
  res.writeHead(200, {
    'content-type': contentTypeOf(resolved),
    'content-length': String(image.data.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(image.data)
}

/** GET /md-preview/api/asset — hand the client one optional heavy dependency. */
async function serveAsset(url, res) {
  const name = url.searchParams.get('name') ?? ''
  const candidates = ASSETS[name]
  if (candidates === undefined) throw new PreviewError('not-found', `unknown asset: ${name}`, 404)
  for (const candidate of candidates) {
    const file = await readFile(new URL(`../../node_modules/${candidate}`, import.meta.url), 'utf8').catch(() => undefined)
    if (file === undefined) continue
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(file)
    return
  }
  throw new PreviewError('not-found', `${name} is not installed in the plugin node_modules`, 404)
}

function contentTypeOf(path) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  return 'application/octet-stream'
}

/**
 * Required service. Declaring it is what makes `ctx.webServer` readable at all:
 * cordis throws "cannot get property … without inject" on an undeclared access,
 * even one sitting behind a fallback.
 */
export const inject = ['webServer']

export function apply(ctx) {
  const get = (name) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }
  const webServer = ctx.webServer ?? get('webServer')
  if (typeof webServer?.register !== 'function') {
    console.warn('[dsh-md-preview] webServer service unavailable — the file API stays unregistered')
    return
  }
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/md-preview/api',
    handler: async (req, res) => {
      if (!isTrustedRequest(req, get('webRuntime')?.trustedHosts ?? [])) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      try {
        if (url.pathname === '/md-preview/api/raw') {
          if (req.method !== 'GET') throw new PreviewError('method-error', 'method not allowed', 405)
          await serveRaw(ctx, url, res)
          return
        }
        if (url.pathname === '/md-preview/api/asset') {
          if (req.method !== 'GET') throw new PreviewError('method-error', 'method not allowed', 405)
          await serveAsset(url, res)
          return
        }
        if (req.method !== 'POST') throw new PreviewError('method-error', 'method not allowed', 405)
        const prefix = '/md-preview/api/'
        if (!url.pathname.startsWith(prefix)) throw new PreviewError('not-found', 'unknown endpoint', 404)
        const method = url.pathname.slice(prefix.length)
        if (method === '' || method.includes('/')) throw new PreviewError('not-found', `unknown method: ${method}`, 404)
        const payload = await readJsonBody(req)
        writeOk(res, await dispatch(ctx, method, payload))
      } catch (error) {
        writeFailure(res, error)
      }
    },
  }), 'md-preview: /md-preview/api routes')
}
