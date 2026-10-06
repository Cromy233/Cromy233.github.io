---
title: 用数据包做一个计时器
date: 2026-10-05 20:00:00
categories:
  - Minecraft
tags:
  - mcfunction
  - 数据包
---

随手记一下最近写的东西，顺便当作分类和标签的示例文章。

<!-- more -->

## 思路

用一个 `scoreboard` 记时间，每 tick 自增，到点触发。

```mcfunction
# demo:core/tick
scoreboard players add @a timer 1
execute as @a[scores={timer=100..}] run function demo:core/on_finish
```

## 为什么用数据包

纯文本，能直接扔进 git 管起来，改一行就是一个 commit，回滚也方便。
