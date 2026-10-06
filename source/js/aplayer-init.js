/* APlayer initialisation. Injected on every page by the Butterfly theme via
   `inject.head` / `inject.bottom` in _config.butterfly.yml. The player itself
   is only created on pages that contain an #aplayer-music element. */
(function () {
  var PLAYLIST = [
    {
      name: '神父雷蒙德战斗BGM',
      artist: '边狱巴士 第十章',
      url: '/music/084ost_theChaplain.mp3',
      cover: '/img/music-cover.svg'
    }
  ]

  function initAPlayer () {
    var container = document.getElementById('aplayer-music')
    if (!container || container.dataset.playerReady || typeof APlayer === 'undefined') return
    container.dataset.playerReady = '1'

    new APlayer({
      container: container,
      theme: '#49b1f5',
      loop: 'all',
      order: 'list',
      preload: 'metadata',
      volume: 0.7,
      mutex: true,
      listFolded: false,
      audio: PLAYLIST
    })
  }

  document.addEventListener('DOMContentLoaded', initAPlayer)
  document.addEventListener('pjax:complete', initAPlayer)
  if (document.readyState !== 'loading') initAPlayer()
})()
