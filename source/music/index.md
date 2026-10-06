---
title: 音乐
date: 2026-10-06 12:00:00
top_img: false
---

在听的曲子。播放器用的是 [APlayer](https://github.com/DIYgod/APlayer)，曲目列表写在仓库的 `source/js/aplayer-init.js` 里。

<div id="aplayer-music"></div>

## 怎么加歌

1. 把音频文件（`mp3` / `m4a` / `flac` 都可以）放进 `source/music/`
2. 编辑 `source/js/aplayer-init.js`，往 `PLAYLIST` 数组里加一条：

```js
{
  name: '曲名',
  artist: '作者',
  url: '/music/文件名.mp3',
  cover: '/img/music-cover.svg'
}
```

3. 提交推送，Actions 会自动重新部署

> 注意：音频文件是直接放进 git 仓库的，所以尽量别放太大的文件（单个文件超过 100 MB GitHub 会拒绝）。
