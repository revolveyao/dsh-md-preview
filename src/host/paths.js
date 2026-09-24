/**
 * Path resolution and filesystem access for the /md-preview/api routes.
 *
 * Two kinds of root exist with different authority: the session workspace
 * (read + write) and the skill roots (read only). Every request path is
 * resolved against them and re-checked *after* symlink resolution, so a
 * request can never name a file outside them — this API hands out file
 * contents, which makes that check the whole security boundary.
 */
import { readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'

/** Markdown extensions the preview accepts, on both the tree and the reader. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx']

/** Extensions the raw (image) endpoint may serve. */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']

/** Directories never descended into while building a tree. This is the whole
 *  exclusion list: dot-directories are listed like any other, because the
 *  markdown people want to read often lives in one (`.deepseek-harness/MEMORY.md`,
 *  `.github/…`, `.dsh/skills/…`) — so the heavy ones have to be named here. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', '.idea', '.vs',
])

/** One directory level never yields more than this many rows. */
const MAX_ENTRIES = 1000

/** Largest file this API reads or writes, in bytes (a markdown document). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

/** Largest image the raw endpoint serves. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024

/** Depth/width bounds of the "does this directory contain markdown" probe. */
const PROBE_MAX_DEPTH = 6
const PROBE_MAX_ENTRIES = 200

/** Error carrying an HTTP status and a stable code for the client. */
export class PreviewError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function isMarkdownFile(path) {
  return MARKDOWN_EXTENSIONS.includes(extname(path).toLowerCase())
}

/** Case- and separator-tolerant comparison form of a path. */
function compareForm(path) {
  const trimmed = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/** Whether `target` is `root` itself or lies below it. */
export function isWithin(root, target) {
  const base = compareForm(root)
  const candidate = compareForm(target)
  return candidate === base || candidate.startsWith(base + sep)
}

/**
 * Resolve `candidate` for reading inside one of `roots`, following symlinks.
 * @throws {PreviewError} `forbidden` when the real path escapes every root.
 */
export async function resolveReadable(roots, candidate) {
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(roots[0].path, candidate)
  const real = await realpath(absolute).catch(() => absolute)
  const root = roots.find((entry) => isWithin(entry.path, real))
  if (root === undefined) throw new PreviewError('forbidden', `path is outside the preview roots: ${candidate}`, 403)
  return { path: real, root }
}

/**
 * Resolve `candidate` for writing: only a writable root qualifies, and the
 * parent directory is realpath'ed so a symlinked parent cannot smuggle the
 * write outside the workspace.
 * @throws {PreviewError} `forbidden` / `read-only` for anything else.
 */
export async function resolveWritable(root, candidate) {
  if (root.writable !== true) throw new PreviewError('read-only', `${root.label} is read-only`, 403)
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root.path, candidate)
  if (!isWithin(root.path, absolute)) throw new PreviewError('forbidden', `path is outside ${root.label}`, 403)
  const realParent = await realpath(dirname(absolute)).catch(() => dirname(absolute))
  if (!isWithin(root.path, realParent)) throw new PreviewError('forbidden', `path is outside ${root.label}`, 403)
  if (!isMarkdownFile(absolute)) throw new PreviewError('unsupported-type', 'only markdown files can be edited', 400)
  return join(realParent, basename(absolute))
}

/** Nearest ancestor containing a `.git` entry; falls back to `cwd`. */
export async function findProjectRoot(cwd) {
  let current = resolve(cwd)
  for (;;) {
    const found = await stat(join(current, '.git')).catch(() => undefined)
    if (found !== undefined) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * The read-only skill roots, in the rank order `dsh-skill-filesystem` scans
 * them, so the tree shows the same skills the agent can load.
 */
export async function skillRoots(cwd, env = process.env) {
  const projectRoot = await findProjectRoot(cwd)
  const dshHome = env.DSH_HOME ?? join(homedir(), '.dsh')
  const agentsHome = env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  return [
    { id: 'project-dsh', label: '项目 .dsh/skills', path: join(projectRoot, '.dsh', 'skills') },
    { id: 'project-agents', label: '项目 .agents/skills', path: join(projectRoot, '.agents', 'skills') },
    { id: 'user-dsh', label: '用户 skills', path: join(dshHome, 'skills') },
    { id: 'user-agents', label: '用户 .agents/skills', path: join(agentsHome, 'skills') },
  ]
}

/**
 * Read+write roots for the user's own memory files, which live **outside** the
 * workspace. The point is to read and adjust that memory from this panel instead
 * of hunting for the file in an editor — so unlike the skill roots these are
 * writable.
 */
export function userMemoryRoots(env = process.env) {
  const dshMemoryDir = env.DSH_MEMORY_HOME ?? join(homedir(), '.deepseek-harness')
  const workbuddyDir = env.WORKBUDDY_HOME ?? join(homedir(), '.workbuddy')
  return [
    { id: 'user-memory', label: '用户级记忆（DSH）', path: dshMemoryDir },
    { id: 'user-memory-workbuddy', label: '用户级记忆（WorkBuddy）', path: workbuddyDir },
  ]
}

/** Whether a directory holds markdown anywhere within the probe bounds. */
async function hasMarkdown(dir, depth = 0) {
  if (depth > PROBE_MAX_DEPTH) return false
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined)
  if (entries === undefined) return false
  let inspected = 0
  for (const entry of entries) {
    if (inspected >= PROBE_MAX_ENTRIES) break
    inspected += 1
    if (entry.isFile() && isMarkdownFile(entry.name)) return true
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      if (await hasMarkdown(join(dir, entry.name), depth + 1)) return true
    }
  }
  return false
}

/**
 * One directory level of a root: markdown files plus directories that contain
 * markdown somewhere below them, so the client only ever sees the md subtree.
 * A missing root is an empty level, not an error.
 */
export async function listDirectory(abs, { workspaceRoot, writableRoots } = {}) {
  const dirents = await readdir(abs, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw new PreviewError('fs-error', `cannot list ${abs}: ${error.message}`, 400)
  })
  const files = []
  const directories = []
  for (const dirent of dirents) {
    if (files.length + directories.length >= MAX_ENTRIES) break
    // Dot-directories are listed like any other: the plugin's own memory files
    // live in `.deepseek-harness/`, and skill roots are `.dsh` / `.agents`. Only
    // the heavy directories named in SKIP_DIRS are left out.
    const path = join(abs, dirent.name)
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) continue
      if (!(await hasMarkdown(path))) continue
      directories.push({ name: dirent.name, path, kind: 'directory' })
    } else if (dirent.isFile() && isMarkdownFile(dirent.name)) {
      files.push({ name: dirent.name, path, kind: 'file' })
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  directories.sort(byName)
  files.sort(byName)
  // `writableRoots` supersedes the older single `workspaceRoot`; the latter is
  // still honoured so existing callers and tests keep working.
  const writable = writableRoots ?? (workspaceRoot !== undefined ? [workspaceRoot] : [])
  return {
    path: abs,
    writable: writable.some((root) => isWithin(root, abs)),
    entries: [...directories, ...files],
  }
}

/** Read one markdown file as UTF-8. */
export async function readTextFile(abs) {
  const info = await stat(abs).catch(() => undefined)
  if (info === undefined) throw new PreviewError('not-found', `no such file: ${abs}`, 404)
  if (!info.isFile()) throw new PreviewError('not-regular-file', `${abs} is not a regular file`, 400)
  if (info.size > MAX_FILE_BYTES) throw new PreviewError('too-large', `file exceeds ${MAX_FILE_BYTES} bytes`, 413)
  const text = await readFile(abs, 'utf8')
  return { path: abs, text, mtimeMs: info.mtimeMs, size: info.size }
}

/**
 * Write one markdown file atomically: a uniquely named temp sibling receives
 * the text and is renamed over the target, so an interrupted save never
 * truncates the document. `expectedMtimeMs` is the version the editor read;
 * a mismatch raises `conflict` instead of overwriting a change made elsewhere
 * (the agent, another editor, a shell command).
 */
export async function writeTextFile(abs, text, expectedMtimeMs) {
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw new PreviewError('too-large', `file exceeds ${MAX_FILE_BYTES} bytes`, 413)
  }
  const before = await stat(abs).catch(() => undefined)
  if (expectedMtimeMs !== undefined) {
    if (before === undefined) throw new PreviewError('conflict', 'the file was deleted after it was read', 409)
    if (before.mtimeMs !== expectedMtimeMs) {
      throw new PreviewError('conflict', 'the file changed on disk after it was read', 409)
    }
  }
  const tmp = `${abs}.dsh-md-preview-${randomUUID()}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, abs)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw new PreviewError('fs-error', `cannot write ${abs}: ${error.message}`, 500)
  }
  const after = await stat(abs)
  return { path: abs, mtimeMs: after.mtimeMs, size: after.size }
}

/**
 * Version probe for the change feed: the client sends the paths it is showing
 * and diffs the answers itself, so the host keeps no per-session cache and a
 * poll costs one stat per watched path.
 *
 * Directories are answered too (a directory's mtime moves when an entry is
 * added or removed), which is how the workspace root is watched for files
 * appearing or leaving; an ordinary file additionally reports its size.
 */
export async function statFiles(paths) {
  return Promise.all(paths.map(async (path) => {
    const info = await stat(path).catch(() => undefined)
    if (info === undefined) return { path, exists: false }
    if (info.isDirectory()) return { path, exists: true, directory: true, mtimeMs: info.mtimeMs }
    return { path, exists: true, directory: false, mtimeMs: info.mtimeMs, size: info.size }
  }))
}

/** Serve one image file (the raw endpoint). */
export async function readImageFile(abs) {
  const info = await stat(abs).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw new PreviewError('not-found', `no such image: ${abs}`, 404)
  if (!IMAGE_EXTENSIONS.includes(extname(abs).toLowerCase())) {
    throw new PreviewError('unsupported-type', 'only images can be served raw', 400)
  }
  if (info.size > MAX_IMAGE_BYTES) throw new PreviewError('too-large', `image exceeds ${MAX_IMAGE_BYTES} bytes`, 413)
  return { data: await readFile(abs), mtimeMs: info.mtimeMs }
}
