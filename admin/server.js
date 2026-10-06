#!/usr/bin/env node
/**
 * Local admin for this blog.
 *
 *   npm run admin      ->  http://127.0.0.1:4001
 *
 * A plain Node HTTP server (no framework) that reads and writes the same files
 * Hexo consumes, so anything saved here is picked up by `hexo generate`.
 *
 * Nothing in here is deployed: `admin/` sits outside `source/`, so Hexo never
 * copies it into the site. The server binds to 127.0.0.1 only.
 */
'use strict'

const http = require('http')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { execFile } = require('child_process')
const yaml = require('js-yaml')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DIR = path.join(ROOT, 'source')
const POSTS_DIR = path.join(SOURCE_DIR, '_posts')
const MOMENTS_FILE = path.join(SOURCE_DIR, '_data', 'shuoshuo.yml')
const UPLOAD_DIR = path.join(SOURCE_DIR, 'img', 'uploads')
const PUBLIC_DIR = path.join(__dirname, 'public')
const VENDOR_DIR = path.join(ROOT, 'node_modules', 'vditor')

const HOST = '127.0.0.1'
const PORT = Number(process.env.ADMIN_PORT) || 4001

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
}

// images land in /img/uploads/ and are inserted inline; everything else lands in
// /files/ and is referenced by link or by an explicit <video>/<audio> tag
const MEDIA_DIR = path.join(SOURCE_DIR, 'files')
// kept below readBody's 60 MB transport cap so the friendly error wins, and well
// under GitHub's 100 MB per-file push limit
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function uploadKind (ext) {
  const mime = MIME[ext] || ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime) return 'file'
  return null
}

/* ------------------------------------------------------------------ helpers */

function sendJson (res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(JSON.stringify(payload))
}

function readBody (req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJsonBody (req) {
  const raw = await readBody(req)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('invalid JSON body')
  }
}

/** Resolve `rel` under `base`, refusing anything that escapes it. */
function safeJoin (base, rel) {
  const resolvedBase = path.resolve(base)
  const target = path.resolve(resolvedBase, rel)
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw new Error('path escapes its base directory')
  }
  return target
}

function splitFrontMatter (raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { data: {}, body: raw }
  let data = {}
  try {
    // CORE_SCHEMA deliberately does not resolve YAML timestamps, so a `date:`
    // value stays the exact string that is in the file instead of becoming a
    // Date (which would be re-rendered in local time and shift the value).
    data = yaml.load(match[1], { schema: yaml.CORE_SCHEMA }) || {}
  } catch (err) {
    throw new Error('front matter is not valid YAML: ' + err.message)
  }
  if (typeof data !== 'object' || Array.isArray(data)) data = {}
  return { data, body: raw.slice(match[0].length) }
}

function joinFrontMatter (data, body) {
  const clean = { ...data }
  for (const key of Object.keys(clean)) {
    const value = clean[key]
    if (value === '' || value === null || value === undefined) delete clean[key]
    else if (Array.isArray(value) && !value.length) delete clean[key]
  }

  const front = yaml
    .dump(clean, { schema: yaml.CORE_SCHEMA, lineWidth: -1, noRefs: true, sortKeys: false })
    .trimEnd()

  // Write LF endings throughout and end the file with exactly one newline.
  // git normalises line endings on commit (core.autocrlf), so this round-trips
  // without producing spurious diffs.
  const text = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')

  return `---\n${front}\n---\n\n${text}\n`
}

function asList (value) {
  if (value === undefined || value === null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

function run (cmd, args, cwd = ROOT) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

async function gitStatus () {
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await run('git', ['status', '--short'])
  const ahead = await run('git', ['rev-list', '--count', '@{upstream}..HEAD'])
  return {
    branch: branch.ok ? branch.stdout.trim() : '',
    dirty: status.ok ? status.stdout.trim() : '',
    ahead: ahead.ok ? Number(ahead.stdout.trim()) : 0
  }
}

/* -------------------------------------------------------------- domain data */

async function listPosts () {
  let names = []
  try {
    names = await fsp.readdir(POSTS_DIR)
  } catch {
    return []
  }

  const posts = []
  for (const name of names.filter(n => n.endsWith('.md'))) {
    const abs = path.join(POSTS_DIR, name)
    const raw = await fsp.readFile(abs, 'utf8')
    let data = {}
    try {
      ({ data } = splitFrontMatter(raw))
    } catch {
      data = {}
    }
    posts.push({
      file: name,
      title: data.title || name.replace(/\.md$/, ''),
      date: data.date ? String(data.date) : '',
      categories: asList(data.categories),
      draft: data.published === false || data.draft === true
    })
  }

  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return posts
}

async function listPages () {
  const entries = await fsp.readdir(SOURCE_DIR, { withFileTypes: true })
  const skip = new Set(['img', 'css', 'js'])
  const pages = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || skip.has(entry.name)) continue
    const rel = entry.name + '/index.md'
    const abs = path.join(SOURCE_DIR, rel)
    if (!fs.existsSync(abs)) continue
    const { data } = splitFrontMatter(await fsp.readFile(abs, 'utf8'))
    pages.push({ path: rel, title: data.title || entry.name, type: data.type || '' })
  }

  pages.sort((a, b) => String(a.title).localeCompare(String(b.title)))
  return pages
}

async function readMoments () {
  if (!fs.existsSync(MOMENTS_FILE)) return []
  const loaded = yaml.load(await fsp.readFile(MOMENTS_FILE, 'utf8'), { schema: yaml.CORE_SCHEMA })
  if (!Array.isArray(loaded)) return []
  // keep every field, including ones this UI does not edit, so saving never
  // silently drops data the user put in the file by hand
  return loaded
    .filter(item => item && typeof item === 'object')
    .map(item => ({ ...item, date: item.date ? String(item.date) : '', content: item.content ? String(item.content) : '' }))
}

async function writeMoments (moments) {
  const clean = (Array.isArray(moments) ? moments : [])
    .filter(m => m && String(m.content || '').trim())
    .map(m => {
      const { date, content, ...rest } = m
      return { date: String(date || '').trim(), content: String(content), ...rest }
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  const header = [
    '# 动态列表，最新的排在最上面。',
    '# content 支持 Markdown，可以插入图片、视频。',
    ''
  ].join('\n')

  await fsp.writeFile(MOMENTS_FILE, header + yaml.dump(clean, {
    schema: yaml.CORE_SCHEMA,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  }), 'utf8')

  return clean.length
}

/* ---------------------------------------------------------------- API routes */

async function handleApi (req, res, parsed) {
  const route = parsed.pathname.replace('/api', '') || '/'
  const query = parsed.searchParams

  if (route === '/state' && req.method === 'GET') {
    const [posts, pages, moments, git] = await Promise.all([
      listPosts(),
      listPages(),
      readMoments(),
      gitStatus()
    ])
    return sendJson(res, 200, { posts, pages, moments, git })
  }

  if (route === '/post' && req.method === 'GET') {
    const file = path.basename(String(query.get('file') || ''))
    if (!file.endsWith('.md')) return sendJson(res, 400, { error: 'file must be a .md name' })
    const abs = path.join(POSTS_DIR, file)
    if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'not found' })
    const { data, body } = splitFrontMatter(await fsp.readFile(abs, 'utf8'))
    return sendJson(res, 200, { file, data, body })
  }

  if (route === '/post' && req.method === 'POST') {
    const payload = await readJsonBody(req)
    const file = String(payload.file || '').trim()
    if (!/^[^/\\]+\.md$/.test(file)) {
      return sendJson(res, 400, { error: 'invalid file name' })
    }
    const data = { ...(payload.data || {}) }
    if (Array.isArray(data.categories)) data.categories = data.categories.filter(Boolean)
    await fsp.mkdir(POSTS_DIR, { recursive: true })
    await fsp.writeFile(path.join(POSTS_DIR, file), joinFrontMatter(data, payload.body), 'utf8')
    return sendJson(res, 200, { ok: true, file })
  }

  if (route === '/post' && req.method === 'DELETE') {
    const file = path.basename(String(query.get('file') || ''))
    if (!file.endsWith('.md')) return sendJson(res, 400, { error: 'file must be a .md name' })
    const abs = path.join(POSTS_DIR, file)
    if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'not found' })
    await fsp.unlink(abs)
    return sendJson(res, 200, { ok: true })
  }

  if (route === '/moments' && req.method === 'GET') {
    return sendJson(res, 200, { moments: await readMoments() })
  }

  if (route === '/moments' && req.method === 'PUT') {
    const payload = await readJsonBody(req)
    const count = await writeMoments(payload.moments)
    return sendJson(res, 200, { ok: true, count })
  }

  if (route === '/page' && req.method === 'GET') {
    const abs = safeJoin(SOURCE_DIR, String(query.get('path') || ''))
    if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'not found' })
    const { data, body } = splitFrontMatter(await fsp.readFile(abs, 'utf8'))
    return sendJson(res, 200, { data, body })
  }

  if (route === '/page' && req.method === 'POST') {
    const payload = await readJsonBody(req)
    const abs = safeJoin(SOURCE_DIR, String(payload.path || ''))
    if (!abs.endsWith('.md')) return sendJson(res, 400, { error: 'path must end with .md' })
    if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'page does not exist' })
    await fsp.writeFile(abs, joinFrontMatter(payload.data || {}, payload.body), 'utf8')
    return sendJson(res, 200, { ok: true })
  }

  if (route === '/upload' && req.method === 'POST') {
    const name = path.basename(String(query.get('name') || 'file'))
    const ext = path.extname(name).toLowerCase()
    const kind = uploadKind(ext)
    if (!kind) {
      return sendJson(res, 400, { error: `unsupported file type: ${ext || '(none)'}` })
    }
    const buffer = await readBody(req)
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return sendJson(res, 400, { error: 'file is larger than 50 MB' })
    }
    // local time so the file name matches the clock the author is looking at
    const now = new Date()
    const p = n => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
    // keep unicode letters/digits so non-latin file names stay readable
    const safeName = name.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+/, '') || 'file'
    const finalName = `${stamp}-${safeName}`

    if (kind === 'image') {
      await fsp.mkdir(UPLOAD_DIR, { recursive: true })
      await fsp.writeFile(path.join(UPLOAD_DIR, finalName), buffer)
      const url = `/img/uploads/${finalName}`
      return sendJson(res, 200, { ok: true, kind, url, markdown: `![](${url})` })
    }

    await fsp.mkdir(MEDIA_DIR, { recursive: true })
    await fsp.writeFile(path.join(MEDIA_DIR, finalName), buffer)
    const url = `/files/${finalName}`
    const markdown = kind === 'video'
      ? `<video src="${url}" controls preload="metadata" style="width:100%"></video>`
      : kind === 'audio'
        ? `<audio src="${url}" controls style="width:100%"></audio>`
        : `[${name}](${url})`
    return sendJson(res, 200, { ok: true, kind, url, markdown })
  }

  if (route === '/git' && req.method === 'POST') {
    const payload = await readJsonBody(req)
    const action = String(payload.action || 'status')

    if (action === 'status') return sendJson(res, 200, await gitStatus())

    if (action === 'commit') {
      const message = String(payload.message || '').trim() || 'chore: update content from admin'
      await run('git', ['add', '-A'])
      const commit = await run('git', ['commit', '-m', message])
      return sendJson(res, 200, {
        ok: commit.ok,
        output: (commit.stdout + commit.stderr).trim(),
        status: await gitStatus()
      })
    }

    if (action === 'push') {
      const push = await run('git', ['push'])
      return sendJson(res, 200, {
        ok: push.ok,
        output: (push.stdout + push.stderr).trim(),
        status: await gitStatus()
      })
    }

    return sendJson(res, 400, { error: 'unknown action' })
  }

  return sendJson(res, 404, { error: 'unknown API route' })
}

/* ------------------------------------------------------------- static files */

function serveFile (res, abs) {
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(data)
  })
}

function serveStatic (res, root, rel) {
  let abs
  try {
    abs = safeJoin(root, decodeURIComponent(rel))
  } catch {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return
  }
  serveFile(res, abs)
}

/* --------------------------------------------------------------------- main */

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://' + HOST + ':' + PORT)

  try {
    if (parsed.pathname.startsWith('/api/')) return await handleApi(req, res, parsed)

    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
      return serveFile(res, path.join(PUBLIC_DIR, 'index.html'))
    }

    if (parsed.pathname.startsWith('/vendor/vditor/')) {
      return serveStatic(res, VENDOR_DIR, parsed.pathname.replace('/vendor/vditor/', ''))
    }

    // serve /img/** and /files/** straight out of source/ so that the exact paths
    // used in the markdown also render inside the editor
    if (parsed.pathname.startsWith('/img/')) {
      return serveStatic(res, path.join(SOURCE_DIR, 'img'), parsed.pathname.replace('/img/', ''))
    }

    if (parsed.pathname.startsWith('/files/')) {
      return serveStatic(res, path.join(SOURCE_DIR, 'files'), parsed.pathname.replace('/files/', ''))
    }

    serveStatic(res, PUBLIC_DIR, parsed.pathname.replace(/^\//, ''))
  } catch (err) {
    sendJson(res, 500, { error: err.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log('\n  博客后台已启动：http://' + HOST + ':' + PORT + '\n  按 Ctrl+C 退出\n')
})
