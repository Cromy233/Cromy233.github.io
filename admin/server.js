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

// Windows editors (Notepad, and PowerShell's own Out-File) may prefix a file
// with a UTF-8 BOM. Left in place it makes the front-matter regex below fail,
// so the post's title/date/categories would read as empty and the next save
// would silently drop them.
function stripBom (text) {
  return String(text).charCodeAt(0) === 0xFEFF ? String(text).slice(1) : String(text)
}

function splitFrontMatter (raw) {
  raw = stripBom(raw)
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

/* ------------------------------------------------------------------- images */

const IMG_ROOT = path.join(SOURCE_DIR, 'img')
const CONFIG_FILE = path.join(ROOT, '_config.butterfly.yml')

// The two folders the image manager owns. `hero` is special: its contents are
// only shown when they are listed in home_hero.backgrounds, so the manager also
// edits that list. `gallery` is a plain folder.
const IMAGE_DIRS = {
  hero: path.join(IMG_ROOT, 'hero'),
  gallery: path.join(IMG_ROOT, 'gallery')
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.bmp']

const isImageName = name => IMAGE_EXTS.includes(path.extname(String(name)).toLowerCase())

// Example paths inside fenced code blocks are documentation, not real
// references, and the syntax highlighter splits them into <span> tags.
function stripCode (text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^```[\s\S]*?^```/gm, '')
    .replace(/^~~~[\s\S]*?^~~~/gm, '')
    .replace(/`[^`\n]*`/g, '')
}

async function listImages (dirKey) {
  const dir = IMAGE_DIRS[dirKey]
  if (!dir) throw new Error('unknown folder: ' + dirKey)

  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files = []
  for (const entry of entries) {
    if (!entry.isFile() || !isImageName(entry.name)) continue
    const stat = await fsp.stat(path.join(dir, entry.name))
    files.push({
      name: entry.name,
      url: `/img/${dirKey}/${entry.name}`,
      size: stat.size,
      mtime: stat.mtimeMs
    })
  }

  files.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return files
}

/** Append -2, -3, ... until the name is free, so an upload never overwrites. */
async function uniqueName (dir, name) {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let candidate = name
  let n = 2
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${n++}${ext}`
  }
  return candidate
}

// Strip anything awkward in a URL or on Windows.
function safeImageName (name) {
  const ext = path.extname(String(name)).toLowerCase()
  const base = path.basename(String(name), path.extname(String(name)))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[._-]+/, '')
  return (base || 'image') + ext
}

function readHeroConfig () {
  const cfg = yaml.load(stripBom(fs.readFileSync(CONFIG_FILE, 'utf8')), { schema: yaml.CORE_SCHEMA }) || {}
  const hero = cfg.home_hero
  if (!hero || typeof hero !== 'object') {
    throw new Error('_config.butterfly.yml 里没有可用的 home_hero 配置段')
  }
  return {
    enable: hero.enable !== false,
    backgrounds: asList(hero.backgrounds).filter(Boolean).map(String),
    interval: hero.interval === undefined || hero.interval === null ? '' : String(hero.interval)
  }
}

/**
 * Rewrite only the `backgrounds:` list inside `home_hero:`.
 *
 * Round-tripping the whole file through js-yaml would delete every comment in
 * this 1100-line config, so the edit is a text splice: the key line and the
 * dash items after it are replaced, everything else stays byte for byte. The
 * result is re-parsed and compared before writing, so a bad edit can never
 * corrupt the config.
 */
async function writeHeroBackgrounds (next) {
  const original = stripBom(await fsp.readFile(CONFIG_FILE, 'utf8'))
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.split(/\r?\n/)

  const heroAt = lines.findIndex(line => /^home_hero:\s*$/.test(line))
  if (heroAt < 0) throw new Error('找不到顶格的 `home_hero:`')

  // the hero block ends at the next line that starts in column 0
  let blockEnd = lines.length
  for (let i = heroAt + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      blockEnd = i
      break
    }
  }

  let keyAt = -1
  for (let i = heroAt + 1; i < blockEnd; i++) {
    if (/^\s+backgrounds:/.test(lines[i])) {
      keyAt = i
      break
    }
  }
  if (keyAt < 0) throw new Error('home_hero 里找不到 `backgrounds:`')

  // skip blank lines between the key and the first item
  let first = keyAt + 1
  while (first < blockEnd && lines[first].trim() === '') first++

  let last = keyAt // inclusive index of the last `- item` line
  for (let i = first; i < blockEnd; i++) {
    if (/^\s*-\s+/.test(lines[i])) {
      last = i
      continue
    }
    break
  }

  const keyIndent = (lines[keyAt].match(/^(\s*)/) || ['', ''])[1]
  let itemIndent = keyIndent + '  '
  if (last > keyAt) {
    const match = lines[first].match(/^(\s*-\s+)/)
    if (match) itemIndent = match[1]
  }

  const rebuilt = [
    ...lines.slice(0, keyAt),
    `${keyIndent}backgrounds:`,
    ...next.map(entry => `${itemIndent}${entry}`),
    ...lines.slice(last + 1)
  ].join(eol)

  // verify before writing: same count, same order, inside the hero block
  const parsed = yaml.load(stripBom(rebuilt), { schema: yaml.CORE_SCHEMA }) || {}
  const got = asList(parsed.home_hero && parsed.home_hero.backgrounds).map(String)
  const same = got.length === next.length && got.every((v, i) => v === String(next[i]))
  if (!same) throw new Error('改写后的配置校验失败，已放弃保存（配置文件未改动）')

  await fsp.writeFile(CONFIG_FILE, rebuilt, 'utf8')
}

/**
 * Which `/img/...` paths are referenced, and from where.
 * Used to warn before deleting or renaming a file that is still in use.
 */
async function findImageReferences () {
  const refs = new Map()

  const add = (url, label) => {
    const key = String(url || '').trim().split(/[?#]/)[0]
    if (!key.startsWith('/img/')) return
    if (!refs.has(key)) refs.set(key, [])
    const list = refs.get(key)
    if (!list.includes(label)) list.push(label)
  }

  const scan = (text, label) => {
    const s = stripCode(text)
    for (const m of s.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) add(m[1], label)
    for (const m of s.matchAll(/<img[^>]*\ssrc=["']([^"']+)["']/gi)) add(m[1], label)
    for (const m of s.matchAll(/<(?:video|audio|source)[^>]*\ssrc=["']([^"']+)["']/gi)) add(m[1], label)
    for (const m of s.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(m[1], label)
  }

  // posts
  try {
    const postFiles = (await fsp.readdir(POSTS_DIR, { withFileTypes: true }))
      .filter(e => e.isFile() && e.name.endsWith('.md'))
    for (const entry of postFiles) {
      const { data, body } = splitFrontMatter(await fsp.readFile(path.join(POSTS_DIR, entry.name), 'utf8'))
      const label = `文章《${String(data.title || path.basename(entry.name, '.md'))}》`
      // cover / top_img hold a bare path, they are not text to scan
      add(data.cover, label + ' 的封面')
      add(data.top_img, label + ' 的顶部图')
      scan(body, label)
    }
  } catch {
    // no posts yet
  }

  // pages: source/<slug>/index.md
  try {
    const dirs = (await fsp.readdir(SOURCE_DIR, { withFileTypes: true }))
      .filter(e => e.isDirectory() && !e.name.startsWith('_') && !['img', 'css', 'js', 'files'].includes(e.name))
    for (const dir of dirs) {
      const indexFile = path.join(SOURCE_DIR, dir.name, 'index.md')
      if (!fs.existsSync(indexFile)) continue
      const { data, body } = splitFrontMatter(await fsp.readFile(indexFile, 'utf8'))
      const label = `页面《${String(data.title || dir.name)}》`
      add(data.top_img, label + ' 的顶部图')
      scan(body, label)
    }
  } catch {
    // ignore
  }

  // moments
  const moments = await readMoments()
  moments.forEach((item, i) => {
    const label = `动态 #${i + 1}（${item.date || '无日期'}）`
    scan(item.content, label)
    add(item.avatar, label + ' 的头像')
  })

  // hero carousel
  try {
    readHeroConfig().backgrounds.forEach(pathname => add(pathname, '首页轮播背景'))
  } catch {
    // config unreadable, nothing to add
  }

  return refs
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
  const loaded = yaml.load(stripBom(await fsp.readFile(MOMENTS_FILE, 'utf8')), { schema: yaml.CORE_SCHEMA })
  if (!Array.isArray(loaded)) return []
  // keep every field, including ones this UI does not edit, so saving never
  // silently drops data the user put in the file by hand
  return loaded
    .filter(item => item && typeof item === 'object')
    .map(item => ({ ...item, date: item.date ? String(item.date) : '', content: item.content ? String(item.content) : '' }))
}

// `2026-10-7` is not a format moment recognises, and one bad date aborts the
// whole site build. Pad anything date-like so saved data is always canonical.
function normaliseDate (value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(String(value || '').trim())
  if (!match) return String(value || '').trim()
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
  const p = n => String(n).padStart(2, '0')
  return `${year}-${p(month)}-${p(day)} ${p(hour)}:${p(minute)}:${p(second)}`
}

// Every moment needs a stable `key`: the theme passes it to giscus as the
// discussion term, so a moment without one gets no comment thread at all.
// A key is assigned once and must never change, or the existing comments are
// orphaned - which is also why editing a moment's date keeps its old key.
function assignMomentKeys (moments) {
  const taken = new Set(moments.map(m => m.key).filter(Boolean))

  for (const moment of moments) {
    if (moment.key) continue
    const digits = String(moment.date || '').replace(/\D/g, '').padEnd(14, '0').slice(0, 14)
    let key = 'm' + digits
    let n = 1
    while (taken.has(key)) key = `m${digits}-${++n}`
    taken.add(key)
    moment.key = key
  }

  return moments
}

async function writeMoments (moments) {
  const clean = assignMomentKeys((Array.isArray(moments) ? moments : [])
    .filter(m => m && String(m.content || '').trim())
    .map(m => {
      const { date, content, ...rest } = m
      return { date: normaliseDate(date), content: String(content), ...rest }
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date))))

  const header = [
    '# 动态列表，最新的排在最上面。',
    '# content 支持 Markdown，可以插入图片、视频。',
    '# key 是这条动态的评论区标识，由后台自动生成；不要手动改，改了旧评论就看不到了。',
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

  if (route === '/images' && req.method === 'GET') {
    const [hero, gallery, references] = await Promise.all([
      listImages('hero'),
      listImages('gallery'),
      findImageReferences()
    ])
    return sendJson(res, 200, {
      hero,
      gallery,
      config: readHeroConfig(),
      references: Object.fromEntries(references)
    })
  }

  if (route === '/images/upload' && req.method === 'POST') {
    const dirKey = String(query.get('dir') || '')
    if (!IMAGE_DIRS[dirKey]) return sendJson(res, 400, { error: 'unknown folder: ' + dirKey })

    const original = path.basename(String(query.get('name') || 'image'))
    if (!isImageName(original)) {
      return sendJson(res, 400, { error: '只支持图片格式：' + IMAGE_EXTS.join(' ') })
    }

    const buffer = await readBody(req)
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return sendJson(res, 400, { error: 'file is larger than 50 MB' })
    }

    const dir = IMAGE_DIRS[dirKey]
    await fsp.mkdir(dir, { recursive: true })
    const finalName = await uniqueName(dir, safeImageName(original))
    await fsp.writeFile(path.join(dir, finalName), buffer)

    return sendJson(res, 200, {
      ok: true,
      name: finalName,
      url: `/img/${dirKey}/${finalName}`,
      renamed: finalName !== original
    })
  }

  if (route === '/images/rename' && req.method === 'POST') {
    const payload = await readJsonBody(req)
    const dirKey = String(payload.dir || '')
    const dir = IMAGE_DIRS[dirKey]
    if (!dir) return sendJson(res, 400, { error: 'unknown folder: ' + dirKey })

    const from = path.basename(String(payload.from || ''))
    if (!isImageName(from)) return sendJson(res, 400, { error: 'invalid source name' })

    const cleaned = safeImageName(String(payload.to || ''))
    if (!isImageName(cleaned)) return sendJson(res, 400, { error: 'invalid target name' })

    const source = path.join(dir, from)
    if (!fs.existsSync(source)) return sendJson(res, 404, { error: '文件不存在' })

    if (cleaned === from) return sendJson(res, 200, { ok: true, name: from, url: `/img/${dirKey}/${from}` })

    const target = path.join(dir, cleaned)
    if (fs.existsSync(target)) return sendJson(res, 409, { error: '同名文件已存在：' + cleaned })

    await fsp.rename(source, target)

    // a renamed hero image would silently drop out of the carousel
    let configUpdated = false
    if (dirKey === 'hero') {
      const before = readHeroConfig().backgrounds
      const oldUrl = `/img/hero/${from}`
      const newUrl = `/img/hero/${cleaned}`
      if (before.includes(oldUrl)) {
        await writeHeroBackgrounds(before.map(entry => (entry === oldUrl ? newUrl : entry)))
        configUpdated = true
      }
    }

    return sendJson(res, 200, {
      ok: true,
      name: cleaned,
      url: `/img/${dirKey}/${cleaned}`,
      configUpdated
    })
  }

  if (route === '/images/delete' && req.method === 'POST') {
    const payload = await readJsonBody(req)
    const dirKey = String(payload.dir || '')
    const dir = IMAGE_DIRS[dirKey]
    if (!dir) return sendJson(res, 400, { error: 'unknown folder: ' + dirKey })

    const name = path.basename(String(payload.name || ''))
    if (!isImageName(name)) return sendJson(res, 400, { error: 'invalid name' })

    const abs = path.join(dir, name)
    if (!fs.existsSync(abs)) return sendJson(res, 404, { error: '文件不存在' })

    if (payload.force !== true) {
      const refs = await findImageReferences()
      const used = refs.get(`/img/${dirKey}/${name}`) || []
      if (used.length) {
        return sendJson(res, 409, { error: 'still referenced', references: used })
      }
    }

    await fsp.unlink(abs)

    // keep the carousel in sync when a listed background is removed
    let configUpdated = false
    if (dirKey === 'hero') {
      const before = readHeroConfig().backgrounds
      const url = `/img/hero/${name}`
      if (before.includes(url)) {
        await writeHeroBackgrounds(before.filter(entry => entry !== url))
        configUpdated = true
      }
    }

    return sendJson(res, 200, { ok: true, configUpdated })
  }

  if (route === '/hero/backgrounds' && req.method === 'PUT') {
    const payload = await readJsonBody(req)
    const list = asList(payload.backgrounds).map(String).filter(Boolean)

    for (const entry of list) {
      if (!entry.startsWith('/img/hero/')) {
        return sendJson(res, 400, { error: '轮播背景只能来自 /img/hero/：' + entry })
      }
    }
    if (!list.length) {
      return sendJson(res, 400, { error: '至少要保留一张背景图，否则首页顶部会是空的' })
    }

    // A file can disappear from disk without going through the admin. Blocking
    // the save in that case would also block reordering or removing the dead
    // entry, so report the missing files instead of refusing the write.
    const missing = list.filter(entry => !fs.existsSync(path.join(SOURCE_DIR, entry.replace(/^\//, ''))))

    await writeHeroBackgrounds(list)
    return sendJson(res, 200, { ok: true, backgrounds: list, missing })
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
