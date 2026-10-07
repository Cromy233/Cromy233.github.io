'use strict'

/**
 * {% netease <id> [type] [auto] %}
 *
 * Embeds the NetEase Cloud Music outchain player. Works in posts, pages and
 * moments (the theme renders moment content through the same tag pipeline).
 *
 *   {% netease 1901371647 %}                      single song
 *   {% netease 1901371647 song %}                 same, explicit
 *   {% netease 2884035 playlist %}                 playlist
 *   {% netease 35029388 album %}                   album
 *   {% netease 7981769 program %}                  radio programme
 *   {% netease 1901371647 song auto %}             start playing on load
 *
 * `<id>` is the number in the song/playlist URL:
 *   https://music.163.com/#/song?id=1901371647
 *                            ^^^^^^^^^^
 */

// NetEase's own `type` query parameter, keyed by the friendly name
const TYPES = {
  song: '2',
  playlist: '0',
  album: '1',
  program: '3'
}

// the compact player is 66px tall; playlists get the full 430px list
const HEIGHT = { song: 66, album: 66, program: 66, playlist: 430 }

const escapeAttr = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

hexo.extend.tag.register('netease', function (args) {
  const [rawId, rawType = 'song', flag] = args
  const type = String(rawType).toLowerCase()
  // be forgiving: accept `song=123`, `123`, or a pasted id=123 fragment
  const id = String(rawId || '').replace(/\D/g, '')

  if (!id) {
    return `<p><em>[netease] 需要一个数字 ID，收到「${escapeAttr(rawId || '')}」</em></p>`
  }

  if (!TYPES[type]) {
    return `<p><em>[netease] 不支持的类型「${escapeAttr(rawType)}」，可用：${Object.keys(TYPES).join(' / ')}</em></p>`
  }

  const auto = String(flag || '').toLowerCase() === 'auto' ? 1 : 0
  const isList = type === 'playlist'
  const height = HEIGHT[type]

  const src = '//music.163.com/outchain/player'
    + `?type=${TYPES[type]}`
    + `&id=${id}`
    + `&auto=${auto}`
    + `&height=${height}`

  return `<div class="netease-embed${isList ? ' netease-embed--list' : ''}">`
    + `<iframe frameborder="no" border="0" marginwidth="0" marginheight="0"`
    + ` width="100%" height="${height + 20}"`
    + ` src="${escapeAttr(src)}"`
    + ' loading="lazy" allow="autoplay"></iframe>'
    + '</div>'
})
