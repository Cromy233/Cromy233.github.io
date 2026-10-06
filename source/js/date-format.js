/* Butterfly renders two timestamps as relative time ("3 分钟前" / "刚刚").
   Rewrite them as a plain YYYY-MM-DD date.

   Loaded through theme.inject.bottom, which is emitted after the theme's own
   main.js, so the DOMContentLoaded listener registered here runs after
   main.js has already filled in #last-push-date. */
(function () {
  function pad (n) {
    return n < 10 ? '0' + n : String(n)
  }

  function toDateOnly (value) {
    if (!value) return null

    const plain = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    if (plain) return plain[0]

    const d = new Date(value)
    if (isNaN(d.getTime())) return null
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  // /diary/ - the full datetime sits in the title attribute
  function fixShuoshuo () {
    const nodes = document.querySelectorAll('.shuoshuo-date')
    for (const node of nodes) {
      const text = toDateOnly(node.getAttribute('title'))
      if (text) node.textContent = text
    }
  }

  // Aside "last updated" - the ISO string sits in data-lastPushDate
  function fixLastPushDate () {
    const el = document.getElementById('last-push-date')
    if (!el) return
    const text = toDateOnly(el.getAttribute('data-lastPushDate'))
    if (text) el.textContent = text
  }

  function run () {
    fixShuoshuo()
    fixLastPushDate()
  }

  document.addEventListener('shuoshuo:rendered', fixShuoshuo)
  document.addEventListener('pjax:complete', run)
  document.addEventListener('DOMContentLoaded', run)
  if (document.readyState !== 'loading') run()
})()
