---
title: 相册
date: 2026-10-06 12:00:00
top_img: false
---

照片都放在 `source/img/gallery/`，用 Butterfly 的相册标签排版，点开看大图。

{% gallery %}
![](/img/gallery/photo-01.svg)
![](/img/gallery/photo-02.svg)
![](/img/gallery/photo-03.svg)
![](/img/gallery/photo-04.svg)
![](/img/gallery/photo-05.svg)
![](/img/gallery/photo-06.svg)
{% endgallery %}

## 怎么加照片

1. 把图片丢进 `source/img/gallery/`（建议先压缩一下，别直接传原图）
2. 在本文的相册标签块里，按 `![](/img/gallery/文件名.jpg)` 的格式加一行
3. 提交推送，等 Actions 跑完就更新了

如果照片很多，可以拆成多个相册块，每块前面加一行 `## 相册名`。
