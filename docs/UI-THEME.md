# UI 主题：守岸人 · 星空版

深色星空 + 角色立绘半透明 + 角色配色，三层叠加。

## 视觉层次

```
┌─────────────────────────────┐
│  Layer 3  聊天 UI（毛玻璃）   │
├─────────────────────────────┤
│  Layer 2  渐变遮罩（可读性）  │
├─────────────────────────────┤
│  Layer 1b 角色立绘 22% 透明   │  ← public/keeper-bg.png
├─────────────────────────────┤
│  Layer 1a 深色星空 #0B1026   │  ← keeper-bg-stars.svg
└─────────────────────────────┘
```

## 配色

| Token | 色值 | 用途 |
|-------|------|------|
| navyDeep | `#0B1026` | 星空主背景 |
| navy | `#1A2A6C` | 玻璃面板 |
| ice | `#D0E8FF` | 正文、助手气泡 |
| cyan | `#00D4FF` | 按钮、光晕、连接状态 |
| silver | `#C0C0C0` | 边框 |

## 背景图

当前使用 **`public/keeper-bg.png`**（全幅星空立绘）。

- 全图 `cover` 铺满窗口
- 左侧渐变遮罩保证聊天可读
- 右侧保留角色、蝴蝶与底部光效

替换图片：直接覆盖 `public/keeper-bg.png`，重启 `pnpm dev`。

## 相关文件

- `src/renderer/components/AppBackground.tsx` — 背景层组件
- `src/renderer/styles/globals.css` — 星空 / 立绘 / 遮罩
- `tailwind.config.js` — keeper 色板
