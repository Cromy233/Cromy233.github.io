/* Image viewer tweaks for the Butterfly lightbox (Fancybox 6).

   Panzoom zooms by a hard-coded 1.5x / 0.5x per wheel tick. That factor is not
   configurable, so `wheelAction` is turned off in the theme (see
   themes/butterfly/source/js/utils.js) and the wheel is handled here instead
   with a zoom proportional to the actual scroll delta.

   Fancybox's own close button is disabled there too; this file adds a single
   one that belongs to the viewer container, so it stays put while images slide. */
(function () {
  // Mirrors Panzoom's own 45ms guard so a fast flick cannot queue up dozens of
  // zooms, while still feeling continuous for a trackpad.
  var THROTTLE_MS = 40
  // ~14% per mouse-wheel notch (deltaY 100). Smaller = slower zoom.
  var ZOOM_PER_PIXEL = 0.0015
  // Caps how far one event can zoom, so a violent trackpad flick stays smooth.
  var MAX_DELTA = 120

  var lastRun = 0

  function clamp (value, min, max) {
    return value < min ? min : value > max ? max : value
  }

  // The Panzoom instance of the slide currently on screen, or null when no
  // lightbox is open.
  function activePanzoom () {
    if (!window.Fancybox || typeof window.Fancybox.getInstance !== 'function') return null

    var instance = window.Fancybox.getInstance()
    if (!instance) return null

    var carousel = typeof instance.getCarousel === 'function' ? instance.getCarousel() : null
    var page = carousel && typeof carousel.getPage === 'function' ? carousel.getPage() : null
    var slide = page && page.slides ? page.slides[0] : null

    return slide && slide.panzoomRef ? slide.panzoomRef : null
  }

  function onWheel (event) {
    var panzoom = activePanzoom()
    if (!panzoom) return

    // Keep the page behind the lightbox from scrolling.
    event.preventDefault()
    event.stopPropagation()

    var now = Date.now()
    if (now - lastRun < THROTTLE_MS) return
    lastRun = now

    var current = panzoom.getScale()
    var next = current * Math.exp(-clamp(event.deltaY, -MAX_DELTA, MAX_DELTA) * ZOOM_PER_PIXEL)

    var min = panzoom.getScale('min')
    var max = panzoom.getScale('max')
    next = clamp(next, min, max)
    if (Math.abs(next - current) < 0.001) return

    // `srcEvent` makes Panzoom zoom around the pointer, same as its own handler
    panzoom.execute('zoomTo', { srcEvent: event, scale: next })
  }

  // Capture phase, so Panzoom's own listener on the viewport never sees this.
  document.addEventListener('wheel', onWheel, { capture: true, passive: false })

  /* -------------------------------------------------------------- close button */

  var CLOSE_CLASS = 'lightbox-close'

  function addCloseButton (container) {
    if (!container || container.querySelector('.' + CLOSE_CLASS)) return

    var button = document.createElement('button')
    button.type = 'button'
    button.className = CLOSE_CLASS
    button.setAttribute('aria-label', '关闭')
    button.title = '关闭'
    button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path d="M19.286 4.714 4.714 19.286M4.714 4.714l14.572 14.572" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

    button.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (window.Fancybox && typeof window.Fancybox.close === 'function') window.Fancybox.close()
    })

    container.appendChild(button)
  }

  // Fancybox builds the viewer DOM on demand; watch for its container appearing
  // rather than guessing when that happens.
  var observer = new MutationObserver(function () {
    var container = document.querySelector('.fancybox__container')
    if (container) addCloseButton(container)
  })

  function startWatching () {
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.body) startWatching()
  else document.addEventListener('DOMContentLoaded', startWatching)
})()

