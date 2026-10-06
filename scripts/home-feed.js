/**
 * Builds the merged, reverse-chronological feed used on the homepage.
 *
 * Combines blog posts with the "moments" stored in source/_data/shuoshuo.yml
 * so both appear in one timeline. Returns an array of:
 *   { type: 'post' | 'moment', timestamp, date, post | moment }
 *
 * Used by themes/butterfly/layout/index.pug via homeFeed().
 */
'use strict'

const moment = require('moment-timezone')

const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss'
const RAW_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/

const pad = n => String(n).padStart(2, '0')

/**
 * Rewrite every moment date into the canonical `YYYY-MM-DD HH:mm:ss` form.
 *
 * Hand-written values such as `2026-10-7` (no zero padding) are not a format
 * moment recognises. The theme's own shuoshuo helper calls moment.utc() on the
 * raw value and throws on it, which aborts the whole page - so the homepage
 * silently stops being generated. Normalising once, before anything renders,
 * keeps loose dates from breaking the build.
 */
function normaliseMomentDates () {
  const data = hexo.locals.get('data')
  const list = data && data.shuoshuo
  if (!Array.isArray(list)) return

  for (const item of list) {
    if (!item || item.date === undefined || item.date === null) continue

    // js-yaml may already have turned an unambiguous value into a Date object
    if (item.date instanceof Date) {
      item.date = moment.utc(item.date).format(DATE_FORMAT)
      continue
    }

    const match = RAW_DATE.exec(String(item.date).trim())
    if (!match) continue

    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
    item.date = `${year}-${pad(month)}-${pad(day)} ` +
      `${pad(hour)}:${pad(minute)}:${pad(second)}`
  }
}

hexo.extend.filter.register('before_generate', normaliseMomentDates)

/**
 * Take over the `index` generator.
 *
 * hexo-generator-index builds the homepage from posts through hexo-pagination,
 * which returns *nothing* when there are no posts - so deleting the last
 * article would silently remove the whole homepage. This blog's homepage is a
 * merged feed that lists everything anyway, so a single static route is both
 * simpler and immune to an empty blog.
 */
hexo.extend.generator.register('index', function () {
  return {
    path: 'index.html',
    layout: ['index'],
    data: { __index: true }
  }
})

/**
 * Same story for the 文章 page: hexo-generator-archive also builds its list
 * through hexo-pagination and produces nothing when there are no posts, which
 * would leave the 文章 menu entry pointing at a 404. This renders every post as
 * a single card list instead.
 */
hexo.extend.generator.register('archive', function (locals) {
  return {
    path: 'archives/index.html',
    layout: ['archive'],
    data: {
      archive: true,
      posts: locals.posts.sort('-date')
    }
  }
})

hexo.extend.helper.register('homeFeed', function (options) {
  const opts = options || {}
  const tz = hexo.config.timezone || 'Asia/Shanghai'
  const entries = []

  // Blog posts
  hexo.locals
    .get('posts')
    .sort('-date')
    .toArray()
    .forEach(post => {
      entries.push({
        type: 'post',
        timestamp: post.date.valueOf(),
        date: post.date,
        post
      })
    })

  // Moments. Reuse the theme's own renderer (shuoshuoFN) so the content shown
  // here is identical to the /moments/ page - it runs the content through
  // Hexo's tag + markdown pipeline and applies the configured timezone.
  const raw = hexo.locals.get('data').shuoshuo || []
  if (raw.length) {
    const renderMoments = hexo.extend.helper.get('shuoshuoFN')
    const moments = typeof renderMoments === 'function' ? renderMoments(raw, {}) : raw

    moments.forEach(m => {
      const parsed = moment.tz(m.date, DATE_FORMAT, tz)
      entries.push({
        type: 'moment',
        timestamp: parsed.valueOf(),
        date: parsed,
        moment: m
      })
    })
  }

  entries.sort((a, b) => b.timestamp - a.timestamp)

  return opts.limit > 0 ? entries.slice(0, opts.limit) : entries
})
