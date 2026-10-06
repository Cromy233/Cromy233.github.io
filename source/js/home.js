/* Homepage enhancements.
 *
 * 1. Cycles the hero background images (home_hero.backgrounds).
 * 2. Groups a run of 2+ images inside one paragraph into a grid, so a moment
 *    with several photos looks like a Bilibili post instead of a tall stack.
 *
 * The lightbox on these images is handled by the theme itself, because the
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

  function groupImageGrids () {
    const paragraphs = document.querySelectorAll('.home-card-body p')
    for (const p of paragraphs) {
      // Count descendants, not direct children: the theme's lightbox may have
      // wrapped the images in <a> elements by the time this runs.
      if (p.querySelectorAll('img').length >= 2) p.classList.add('img-grid')
    }
  }

  function run () {
    initHero()
    groupImageGrids()
  }

  document.addEventListener('DOMContentLoaded', run)
  document.addEventListener('pjax:complete', run)
  if (document.readyState !== 'loading') run()
})()
