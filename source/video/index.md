---
title: 视频
date: 2026-10-06 12:00:00
top_img: false
---

还没有放视频。这个页面已经准备好了，下面是几种加视频的方法。

## 本地视频

把视频压成 `mp4` 后放进 `source/video/`，然后在本文里写：

```html
<video src="/video/xxx.mp4" controls preload="metadata" style="width:100%"></video>
```

## 嵌入 B 站视频

在 B 站视频页面点「分享 → 嵌入代码」，把尺寸改成下面这样再粘进来：

```html
<iframe src="//player.bilibili.com/player.html?isOutside=true&bvid=BVxxxxxxxxxx&p=1"
        scrolling="no" border="0" frameborder="no" framespacing="0"
        allowfullscreen="true" style="width:100%;height:420px"></iframe>
```

## 嵌入 YouTube

```html
<iframe width="100%" height="420" src="https://www.youtube.com/embed/xxxxxxxxxxx"
        title="YouTube video player" frameborder="0" allowfullscreen></iframe>
```

> 提示：B 站和 YouTube 的 iframe 在国内访问要看你自己的网络情况，本地存的 mp4 最省事。
