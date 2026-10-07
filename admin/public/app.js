/* Local blog admin UI.
 *
 * Talks to admin/server.js. Everything it saves goes straight into the files
 * Hexo reads, so `npm run build` / the GitHub Actions run pick it up unchanged.
 */
'use strict'

/* ------------------------------------------------------------------ helpers */

const $ = id => document.getElementById(id)

function toast (message, isError) {
  const el = $('toast')
  el.textContent = message
  el.classList.toggle('error', Boolean(isError))
  el.classList.add('show')
  window.clearTimeout(toast._timer)
  toast._timer = window.setTimeout(() => el.classList.remove('show'), 2600)
}

async function api (pathname, options) {
  const res = await fetch(pathname, options)
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  if (!res.ok || data.error) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

function post (pathname, body) {
  return api(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function localStamp () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** File name for a brand new post, derived from the title. */
function slugifyFile (title) {
  const base = String(title || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-')
  return `${base || 'untitled'}.md`
}

/* ------------------------------------------------------------------- editor */

const KIND_LABEL = { image: '图片', video: '视频', audio: '音频', file: '文件' }

const uploadHandler = getEditor => async files => {
  for (const file of files) {
    try {
      const res = await fetch('/api/upload?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        body: file
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'upload failed')
      getEditor().insertValue(`\n${data.markdown}\n`)
      toast((KIND_LABEL[data.kind] || '文件') + '已上传并插入')
    } catch (err) {
      toast('上传失败：' + err.message, true)
    }
  }
}

function createEditor (element, value, placeholder, getSelf) {
  return new Vditor(element, {
    mode: 'ir',
    height: '100%',
    value: value || '',
    placeholder: placeholder || '',
    // keep every Vditor asset local instead of pulling from unpkg
    cdn: '/vendor/vditor',
    cache: { enable: false },
    outline: false,
    resize: { enable: false },
    counter: { enable: false },
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', '|',
      'quote', 'line', '|',
      'code', 'inline-code', 'link', 'table', '|',
      'upload', '|',
      'undo', 'redo', '|',
      'fullscreen'
    ],
    upload: {
      accept: 'image/*,video/*,audio/*,.pdf,.zip,.txt,.md',
      handler: uploadHandler(getSelf)
    }
  })
}

/* --------------------------------------------------------------------- state */

const state = {
  view: 'posts',
  posts: [],
  pages: [],
  moments: [],
  post: { file: null, isNew: false },
  moment: { index: -1 },
  page: { path: null },
  editors: { post: null, moment: null, page: null },
  pending: { post: null, moment: null, page: null }
}

async function refreshState () {
  const data = await api('/api/state')
  state.posts = data.posts
  state.pages = data.pages
  state.moments = data.moments
  renderGitBadge(data.git)
  renderPostList()
  renderMomentList()
  renderPageList()
}

function renderGitBadge (git) {
  if (!git) return
  const lines = [`分支 ${git.branch || '?'}`]
  if (git.ahead) lines.push(`领先远端 ${git.ahead} 个提交`)
  lines.push(git.dirty ? `有 ${git.dirty.split('\n').length} 处未提交改动` : '工作区干净')
  $('git-badge').textContent = lines.join('\n')
}

/* --------------------------------------------------------------- view switch */

function showView (name) {
  state.view = name
  for (const section of document.querySelectorAll('.view')) {
    section.classList.toggle('active', section.id === 'view-' + name)
  }
  for (const button of document.querySelectorAll('.nav-item')) {
    button.classList.toggle('active', button.dataset.view === name)
  }

  // build the editor for this view now that its container is visible
  const editorKey = { posts: 'post', moments: 'moment', pages: 'page' }[name]
  if (editorKey) ensureEditor(editorKey)
  if (name === 'publish') refreshGit()
}

for (const button of document.querySelectorAll('.nav-item')) {
  button.addEventListener('click', () => showView(button.dataset.view))
}

/* ------------------------------------------------------------------- articles */

function renderPostList () {
  const host = $('post-list')
  host.innerHTML = ''

  if (!state.posts.length) {
    const empty = document.createElement('div')
    empty.className = 'list-empty'
    empty.textContent = '还没有文章，点右上角「新建文章」。'
    host.appendChild(empty)
    return
  }

  for (const post of state.posts) {
    const item = document.createElement('div')
    item.className = 'list-item'
    if (post.file === state.post.file) item.classList.add('active')

    const title = document.createElement('div')
    title.className = 'li-title'
    title.textContent = post.draft ? `[草稿] ${post.title}` : post.title

    const sub = document.createElement('div')
    sub.className = 'li-sub'
    sub.textContent = [post.date, post.categories.join(' / ')].filter(Boolean).join(' · ')

    item.append(title, sub)

    const actions = document.createElement('div')
    actions.className = 'li-actions'
    const del = document.createElement('button')
    del.className = 'btn btn-mini btn-danger'
    del.textContent = '删除'
    del.addEventListener('click', async event => {
      event.stopPropagation()
      if (!window.confirm(`删除《${post.title}》？此操作不可撤销。`)) return
      try {
        await api('/api/post?file=' + encodeURIComponent(post.file), { method: 'DELETE' })
        if (state.post.file === post.file) resetPostEditor()
        toast('已删除')
        await refreshState()
      } catch (err) {
        toast('删除失败：' + err.message, true)
      }
    })
    actions.appendChild(del)
    item.appendChild(actions)

    item.addEventListener('click', () => openPost(post.file))
    host.appendChild(item)
  }
}

function setCoverPreview () {
  const value = $('post-cover').value.trim()
  const box = $('cover-preview')
  if (!value) {
    box.hidden = true
    $('cover-preview-img').removeAttribute('src')
    return
  }
  $('cover-preview-img').src = value
  box.hidden = false
}

function resetPostEditor () {
  state.post = { file: null, isNew: false, data: {} }
  $('post-title').value = ''
  $('post-date').value = ''
  $('post-categories').value = ''
  $('post-file').value = ''
  $('post-cover').value = ''
  $('save-post').disabled = true
  setCoverPreview()
  setEditorValue('post', '')
}

const EDITOR_TARGETS = {
  post: { host: 'post-vditor', placeholder: '正文…支持 Markdown，图片可粘贴或拖入' },
  moment: { host: 'moment-vditor', placeholder: '写点什么…' },
  page: { host: 'page-vditor', placeholder: '' }
}

// Editors are created lazily, the first time their view is shown. Creating them
// up front would build two of them inside a display:none container, where
// Vditor cannot measure itself and ends up fighting the layout.
function ensureEditor (which) {
  if (state.editors[which]) return state.editors[which]

  const target = EDITOR_TARGETS[which]
  const host = target && $(target.host)
  if (!host) return null

  const initial = state.pending[which] || ''
  state.pending[which] = null
  state.editors[which] = createEditor(host, initial, target.placeholder, () => state.editors[which])
  return state.editors[which]
}

function setEditorValue (which, value) {
  const editor = state.editors[which]
  if (editor && typeof editor.setValue === 'function') {
    editor.setValue(value || '')
  } else {
    // editor not created yet - hand the value to its constructor instead
    state.pending[which] = value || ''
  }
}

function getEditorValue (which) {
  const editor = state.editors[which]
  if (editor && typeof editor.getValue === 'function') return editor.getValue()
  return state.pending[which] || ''
}

async function openPost (file) {
  try {
    const data = await api('/api/post?file=' + encodeURIComponent(file))
    state.post = { file, isNew: false, data: data.data || {} }
    ensureEditor('post')

    $('post-title').value = data.data.title || ''
    $('post-date').value = data.data.date ? String(data.data.date) : ''
    $('post-categories').value = [].concat(data.data.categories || []).join(', ')
    $('post-file').value = file
    $('post-cover').value = data.data.cover || ''
    $('save-post').disabled = false

    setCoverPreview()
    setEditorValue('post', data.body)
    renderPostList()
  } catch (err) {
    toast('打开失败：' + err.message, true)
  }
}

function newPost () {
  state.post = { file: null, isNew: true, data: {} }
  ensureEditor('post')
  $('post-title').value = ''
  $('post-date').value = localStamp()
  $('post-categories').value = ''
  $('post-file').value = ''
  $('post-cover').value = ''
  $('save-post').disabled = false
  setCoverPreview()
  setEditorValue('post', '')
  renderPostList()
  $('post-title').focus()
}

async function savePost () {
  const title = $('post-title').value.trim()
  if (!title) {
    toast('请先填标题', true)
    return
  }

  let file = $('post-file').value.trim()
  if (!file) {
    file = slugifyFile(title)
    $('post-file').value = file
  }
  if (!file.endsWith('.md')) file += '.md'

  const categories = $('post-categories').value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  // keep front-matter fields this form does not edit (top_img, description, ...)
  const data = { ...(state.post.data || {}), title, date: $('post-date').value.trim() || localStamp() }
  if (categories.length) data.categories = categories
  else delete data.categories

  // cover drives the banner at the top of the article page; drop the key
  // entirely when empty so no stray `cover:` line is written
  const cover = $('post-cover').value.trim()
  if (cover) data.cover = cover
  else delete data.cover

  try {
    await post('/api/post', { file, data, body: getEditorValue('post') })
    state.post = { file, isNew: false, data }
    $('post-file').value = file
    toast('已保存：' + file)
    await refreshState()
  } catch (err) {
    toast('保存失败：' + err.message, true)
  }
}

/* -------------------------------------------------------------------- moments */

function renderMomentList () {
  const host = $('moment-list')
  host.innerHTML = ''

  if (!state.moments.length) {
    const empty = document.createElement('div')
    empty.className = 'list-empty'
    empty.textContent = '还没有动态，点右上角「新增动态」。'
    host.appendChild(empty)
    return
  }

  state.moments.forEach((moment, index) => {
    const item = document.createElement('div')
    item.className = 'list-item'
    if (index === state.moment.index) item.classList.add('active')

    const title = document.createElement('div')
    title.className = 'li-title'
    title.textContent = (moment.content || '').replace(/[#*`>\-!\[\]]/g, ' ').trim().slice(0, 46) || '(空)'

    const sub = document.createElement('div')
    sub.className = 'li-sub'
    sub.textContent = moment.date || ''

    item.append(title, sub)

    const actions = document.createElement('div')
    actions.className = 'li-actions'
    const del = document.createElement('button')
    del.className = 'btn btn-mini btn-danger'
    del.textContent = '删除'
    del.addEventListener('click', async event => {
      event.stopPropagation()
      if (!window.confirm('删除这条动态？')) return
      const next = state.moments.slice()
      next.splice(index, 1)
      try {
        await api('/api/moments', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moments: next })
        })
        if (state.moment.index === index) state.moment.index = -1
        toast('已删除')
        await refreshState()
      } catch (err) {
        toast('删除失败：' + err.message, true)
      }
    })
    actions.appendChild(del)
    item.appendChild(actions)

    item.addEventListener('click', () => openMoment(index))
    host.appendChild(item)
  })
}

function openMoment (index) {
  state.moment.index = index
  const moment = state.moments[index] || { date: '', content: '' }
  ensureEditor('moment')
  $('moment-date').value = moment.date || ''
  $('moment-key').value = moment.key || ''
  $('save-moment').disabled = false
  setEditorValue('moment', moment.content)
  renderMomentList()
}

function newMoment () {
  state.moment.index = -1
  ensureEditor('moment')
  $('moment-date').value = localStamp()
  $('moment-key').value = ''
  $('save-moment').disabled = false
  setEditorValue('moment', '')
  renderMomentList()
}

async function saveMoment () {
  const date = $('moment-date').value.trim() || localStamp()
  const content = getEditorValue('moment')

  if (!content.trim()) {
    toast('动态内容不能为空', true)
    return
  }

  const next = state.moments.slice()
  if (state.moment.index >= 0) {
    // spread the existing entry so fields this UI does not edit are preserved
    next[state.moment.index] = { ...next[state.moment.index], date, content }
  } else {
    next.push({ date, content })
  }

  try {
    await api('/api/moments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moments: next })
    })
    toast('已保存')
    await refreshState()
    // the server sorts newest-first, so re-select by matching content
    const found = state.moments.findIndex(m => m.content === content)
    if (found >= 0) openMoment(found)
  } catch (err) {
    toast('保存失败：' + err.message, true)
  }
}

/* ---------------------------------------------------------------------- pages */

function renderPageList () {
  const host = $('page-list')
  host.innerHTML = ''

  if (!state.pages.length) {
    const empty = document.createElement('div')
    empty.className = 'list-empty'
    empty.textContent = '没有找到页面。'
    host.appendChild(empty)
    return
  }

  for (const page of state.pages) {
    const item = document.createElement('div')
    item.className = 'list-item'
    if (page.path === state.page.path) item.classList.add('active')

    const title = document.createElement('div')
    title.className = 'li-title'
    title.textContent = page.title

    const sub = document.createElement('div')
    sub.className = 'li-sub'
    sub.textContent = page.path

    item.append(title, sub)
    item.addEventListener('click', () => openPage(page.path))
    host.appendChild(item)
  }
}

async function openPage (pathname) {
  try {
    const data = await api('/api/page?path=' + encodeURIComponent(pathname))
    state.page.path = pathname
    ensureEditor('page')
    $('page-title').textContent = `${data.data.title || pathname}（${pathname}）`
    $('save-page').disabled = false
    setEditorValue('page', data.body)
    renderPageList()
  } catch (err) {
    toast('打开失败：' + err.message, true)
  }
}

async function savePage () {
  if (!state.page.path) {
    toast('先选一个页面', true)
    return
  }
  try {
    await post('/api/page', {
      path: state.page.path,
      data: { title: $('page-title').textContent.split('（')[0] },
      body: getEditorValue('page')
    })
    toast('已保存：' + state.page.path)
  } catch (err) {
    toast('保存失败：' + err.message, true)
  }
}

/* -------------------------------------------------------------------- publish */

async function refreshGit () {
  try {
    const git = await api('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    })
    renderGitBadge(git)
  } catch (err) {
    toast('读取 git 状态失败：' + err.message, true)
  }
}

async function gitAction (action, message) {
  $('publish-output').textContent = '执行中…'
  try {
    const result = await api('/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, message })
    })
    $('publish-output').textContent = result.output || (action === 'push' ? '推送完成' : '提交完成')
    renderGitBadge(result.status)
    await refreshState()
  } catch (err) {
    $('publish-output').textContent = err.message
    toast('失败：' + err.message, true)
  }
}

/* ------------------------------------------------------------------- wiring */

$('new-post').addEventListener('click', newPost)
$('save-post').addEventListener('click', savePost)

// Cover picker: reuse the same /api/upload endpoint, but set the front-matter
// field instead of inserting anything into the body.
const coverInput = document.createElement('input')
coverInput.type = 'file'
coverInput.accept = 'image/*'
coverInput.addEventListener('change', async () => {
  const file = coverInput.files && coverInput.files[0]
  coverInput.value = ''
  if (!file) return
  try {
    const res = await fetch('/api/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      body: file
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error || 'upload failed')
    $('post-cover').value = data.url
    setCoverPreview()
    toast('封面已设置')
  } catch (err) {
    toast('上传失败：' + err.message, true)
  }
})
$('pick-cover').addEventListener('click', () => coverInput.click())
$('clear-cover').addEventListener('click', () => {
  $('post-cover').value = ''
  setCoverPreview()
})
$('post-cover').addEventListener('input', setCoverPreview)

$('insert-more').addEventListener('click', () => {
  const editor = ensureEditor('post')
  if (!editor) return
  editor.insertValue('\n<!-- more -->\n')
  toast('已插入摘要分隔')
})

$('new-moment').addEventListener('click', newMoment)
$('save-moment').addEventListener('click', saveMoment)
$('save-page').addEventListener('click', savePage)

$('btn-commit').addEventListener('click', () => gitAction('commit', $('commit-message').value))
$('btn-push').addEventListener('click', () => gitAction('push'))
$('btn-status').addEventListener('click', refreshGit)

showView('posts')
refreshState().catch(err => toast('初始化失败：' + err.message, true))
