/**
 * Warns about image paths in the config that point at files which do not exist.
 *
 * A missing image is the quietest possible failure: the page still builds, the
 * HTML still contains `background-image: url(...)`, and the browser just shows
 * nothing. That makes "I replaced the picture and now the hero is blank" very
 * hard to diagnose, so surface it as a build warning instead.
 *
 * Covers the hand-written image lists that are easy to get out of sync:
 *   home_hero.backgrounds, home_hero.avatar, avatar.img, favicon,
 *   default_top_img, index_img, archive_img, cover of each post, and every
 *   image referenced from a moment.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const SOURCE_DIR = path.join(hexo.base_dir, 'source')

// Filled in by the generator below, so assets Hexo itself produces (and
// therefore are not on disk under source/) are not reported as missing.
const GENERATED = new Set(['/css/images/banner.jpg'])

function isLocalPath (value) {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v) return false
  // skip absolute URLs, protocol-relative URLs, data URIs and bare colours
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(v)) return false
  if (/^(?:data:|#)/i.test(v)) return false
  if (/^(?:#|rgb|rgba|hsl|hsla)/i.test(v)) return false
  return true
}

// `/img/hero/ocean.png` -> `<source>/img/hero/ocean.png`
function toSourceFile (url) {
  const clean = String(url).trim().split(/[?#]/)[0]
  if (!clean.startsWith('/')) return null
  return path.join(SOURCE_DIR, clean.replace(/^\//, ''))
}

function exists (url) {
  if (!isLocalPath(url)) return true
  if (GENERATED.has(String(url).trim())) return true
  const file = toSourceFile(url)
  if (!file) return true
  return fs.existsSync(file)
}

// yaml may hand back a Date for an unambiguous value; show it in the same
// `YYYY-MM-DD HH:mm:ss` shape the file uses
function formatDate (value) {
  if (!value) return '无日期'
  if (value instanceof Date) {
    const p = n => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())} ` +
      `${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`
  }
  return String(value)
}

function collectFromConfig () {
  const theme = hexo.theme.config || {}
  const site = hexo.config || {}
  const found = []

  const push = (label, value) => {
    if (typeof value === 'string') {
      if (!exists(value)) found.push({ label, value })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => push(`${label}[${i}]`, v))
    }
  }

  const hero = theme.home_hero || {}
  push('home_hero.backgrounds', hero.backgrounds)
  push('home_hero.avatar', hero.avatar)
  push('avatar.img', theme.avatar && theme.avatar.img)
  push('favicon', theme.favicon)
  push('default_top_img', theme.default_top_img)
  push('index_img', theme.index_img)
  push('archive_img', theme.archive_img)
  push('category_img', theme.category_img)
  push('tag_img', theme.tag_img)

  if (site.favicon && site.favicon !== theme.favicon) push('favicon (site)', site.favicon)

  return found
}

// Example paths inside fenced code blocks or inline code are documentation, not
// real references - and the code highlighter wraps them in <span> tags, which
// would also break the path regex. Strip both before scanning.
function stripCode (text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^```[\s\S]*?^```/gm, '')
    .replace(/^~~~[\s\S]*?^~~~/gm, '')
    .replace(/`[^`\n]*`/g, '')
}

function collectFromContent () {
  const found = []

  const check = (label, value) => {
    if (!isLocalPath(value)) return
    if (!exists(value)) found.push({ label, value })
  }

  const scanText = label => text => {
    const s = stripCode(text)
    // markdown images: ![alt](/path/to.png)
    for (const m of s.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) check(label, m[1])
    // html images: <img src="/path/to.png">
    for (const m of s.matchAll(/<img[^>]*\ssrc=["']([^"']+)["']/gi)) check(label, m[1])
    // video / audio / source elements inserted by the admin
    for (const m of s.matchAll(/<(?:video|audio|source)[^>]*\ssrc=["']([^"']+)["']/gi)) check(label, m[1])
  }

  // `raw` is the original markdown; `content` is already rendered HTML, which
  // the highlighter has chopped into spans.
  const sourceOf = item => item.raw || item._content || item.content

  const posts = hexo.locals.get('posts')
  if (posts && posts.each) {
    posts.each(post => {
      const label = `文章《${post.title}》`
      check(label + ' 的 cover', post.cover)
      check(label + ' 的 top_img', post.top_img)
      scanText(label + ' 正文')(sourceOf(post))
    })
  }

  const pages = hexo.locals.get('pages')
  if (pages && pages.each) {
    pages.each(page => {
      const label = `页面《${page.title || page.path}》`
      check(label + ' 的 top_img', page.top_img)
      scanText(label + ' 正文')(sourceOf(page))
    })
  }

  // moments store raw markdown, and are not run through Hexo's render pipeline
  // before this filter, so their content is still the original text
  const data = hexo.locals.get('data')
  const moments = data && data.shuoshuo
  if (Array.isArray(moments)) {
    moments.forEach((item, i) => {
      if (!item) return
      const label = `动态 #${i + 1}（${formatDate(item.date)}）`
      check(label + ' 的 avatar', item.avatar)
      scanText(label)(item.content)
    })
  }

  return found
}

// priority 20 so this runs after home-feed.js's date normalisation (priority 10)
hexo.extend.filter.register('before_generate', function () {
  const missing = collectFromConfig().concat(collectFromContent())
  if (!missing.length) return

  hexo.log.warn('以下图片在配置里被引用，但 source/ 下找不到对应文件：')
  for (const item of missing) {
    hexo.log.warn(`  ${item.label} -> ${item.value}`)
  }
  hexo.log.warn('这些位置会显示空白。请检查文件名和路径是否写对（注意大小写和扩展名）。')
}, 20)
