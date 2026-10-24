/* Homepage / feed enhancements.
 *
 * 1. Cycles the hero background images (home_hero.backgrounds).
 * 2. Turns runs of images into a Twitter / WeChat-Moments style grid.
 *
 * The lightbox on those images is handled by the theme itself, because the
 * feed container reuses id="article-container".
 */
(function () {
  function initHero () {
    const hero = document.getElementById('home-hero')
    if (!hero || hero.dataset.heroReady) return

    const slides = hero.querySelectorAll('.home-hero-slide')
    if (slides.length < 2) return
    hero.dataset.heroReady = '1'

    const seconds = parseFloat(hero.dataset.interval)
    const delay = (isNaN(seconds) || seconds <= 0 ? 7 : seconds) * 1000
    let index = 0

    window.setInterval(function () {
      slides[index].classList.remove('is-active')
      index = (index + 1) % slides.length
      slides[index].classList.add('is-active')
    }, delay)
  }

  /* ------------------------------------------------------------ image grid */

  // Containers whose direct children may be image paragraphs:
  //   .home-card-body   - homepage / 文章 page cards
  //   .shuoshuo-content - the 动态 page
  var CONTAINERS = '.home-card-body, .shuoshuo-content'

  // One grid item is either the <a> the lightbox wrapped the image in, or the
  // bare <img> when the lightbox has not run yet.
  function isImageItem (node) {
    if (node.nodeType !== 1) return false
    if (node.tagName === 'IMG') return true
    return node.tagName === 'A' && !!node.querySelector('img') && !node.textContent.trim()
  }

  /**
   * A paragraph that holds nothing but images (and the <br> markdown leaves
   * between them). Anything with real text is left alone.
   */
  function isImageOnlyParagraph (el) {
    if (el.tagName !== 'P') return false

    var images = 0
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i]

      if (node.nodeType === 3) {
        if (node.textContent.replace(/[\s\u00a0]+/g, '')) return false
        continue
      }
      if (node.nodeType !== 1) continue

      if (node.tagName === 'BR') continue
      if (isImageItem(node)) {
        images++
        continue
      }
      return false
    }

    return images > 0
  }

  function itemsOf (paragraph) {
    var items = []
    for (var i = 0; i < paragraph.children.length; i++) {
      var child = paragraph.children[i]
      if (isImageItem(child)) items.push(child)
    }
    return items
  }

  // 1 image stays on its own; 2 and 4 read best as a square pair / quad;
  // 3 and 5+ use three columns, like WeChat Moments.
  function gridClassFor (count) {
    if (count === 2) return 'img-grid--two'
    if (count === 4) return 'img-grid--four'
    return 'img-grid--many'
  }

  function groupImages (root) {
    if (!root || root.dataset.imagesGrouped) return
    root.dataset.imagesGrouped = '1'

    var blocks = Array.prototype.slice.call(root.children)
    var run = []

    var flush = function () {
      if (!run.length) return

      var items = []
      run.forEach(function (paragraph) {
        items = items.concat(itemsOf(paragraph))
      })

      if (items.length >= 2) {
        var grid = document.createElement('div')
        grid.className = 'img-grid ' + gridClassFor(items.length)
        grid.dataset.count = String(items.length)

        run[0].parentNode.insertBefore(grid, run[0])
        items.forEach(function (item) { grid.appendChild(item) })
        run.forEach(function (paragraph) { paragraph.remove() })
      } else if (items.length === 1) {
        run[0].classList.add('img-single')
      }

      run = []
    }

    for (var i = 0; i < blocks.length; i++) {
      if (isImageOnlyParagraph(blocks[i])) run.push(blocks[i])
      else flush()
    }
    flush()
  }

  /* ------------------------------------------------ per-card lightbox groups */

  /* The theme wraps every image on the page with the same
     `data-fancybox="gallery"` value, so the viewer happily pages from one
     moment into the next one's photos. Fancybox resolves the group from the
     attribute at click time, so giving each card its own value is enough to
     keep the arrows inside that card. */
  function scopeLightboxGroups () {
    var cards = document.querySelectorAll('.home-card, .shuoshuo-item')

    cards.forEach(function (card, index) {
      var group = 'post-' + index
      card.querySelectorAll('a[data-fancybox]').forEach(function (link) {
        link.setAttribute('data-fancybox', group)
      })
    })
  }

  function run () {
    initHero()
    document.querySelectorAll(CONTAINERS).forEach(groupImages)
    scopeLightboxGroups()
  }

  document.addEventListener('DOMContentLoaded', run)
  document.addEventListener('pjax:complete', run)
  // the 动态 page builds its items from JSON and announces when they are ready;
  // the theme listens for the same event, and its listener was registered
  // first, so the images are already lightbox-wrapped by the time this runs
  document.addEventListener('shuoshuo:rendered', run)
  if (document.readyState !== 'loading') run()

  // the theme may wrap images slightly after us (it runs its own DOMContentLoaded
  // pass), so re-apply the group names once the page has fully settled
  window.addEventListener('load', scopeLightboxGroups)
})()
