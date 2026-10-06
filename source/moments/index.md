---
title: 动态
date: 2026-10-06 12:00:00
type: shuoshuo
top_img: false
---

随手记的东西，最新的在最上面。每条可以带文字、多张图片、视频，也可以打标签。

内容写在 `source/_data/shuoshuo.yml`。每条长这样：

```yaml
- date: 2026-10-07 20:30:00
  content: 今天写了点东西，顺便试试多图。
  tags:
    - 日常
```

`content` 支持完整的 Markdown，所以图片、视频都能直接写进去：

```yaml
- date: 2026-10-07 20:30:00
  content: |
    今天天气不错，出去转了转。

    ![](/img/gallery/photo-01.svg)
    ![](/img/gallery/photo-02.svg)
  tags:
    - 日常
```

视频用 HTML 写（本地 mp4 或者 B 站 / YouTube 的 iframe 都行）：

```yaml
- date: 2026-10-07 21:00:00
  content: |
    录了段东西。

    <video src="/video/demo.mp4" controls preload="metadata" style="width:100%"></video>
  tags:
    - 视频
```
