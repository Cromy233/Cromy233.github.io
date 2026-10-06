---
title: 这个博客是怎么来的
date: 2026-10-06 23:40:00
categories:
  - 折腾
tags:
  - Hexo
  - Butterfly
  - GitHub Pages
---

这个仓库原本只有一个整蛊用的「原神启动装置」页面，现在换成了正经的个人博客。

<!-- more -->

## 用了什么

- **Hexo** —— 静态博客生成器
- **Butterfly** —— 主题
- **GitHub Actions** —— 推送到 `main` 后自动构建，再发布到 GitHub Pages

## 怎么发新文章

在仓库根目录执行：

```bash
npx hexo new "文章标题"
```

然后在 `source/_posts/` 里编辑生成的 Markdown 文件。本地预览：

```bash
npx hexo server
```

打开 <http://localhost:4000> 就能看到效果。写完直接提交推送，剩下的交给 Actions。
