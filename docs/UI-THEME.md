# UI 主题与外观

运行时换肤：设置 → **个性化 → 外观**。内置 3 套预设，支持本地上传背景与头像。

## 主题预设

| ID | 名称 | 说明 |
|----|------|------|
| `shorekeeper` | 守岸人 · 星空 | 默认深蓝 + cyan |
| `midnight` | 午夜紫 | 深紫 + 粉紫强调 |
| `dawn` | 拂晓 | 略浅背景 + 暖色 accent |

预设定义：`src/config/themes/`。Tailwind `keeper-*` 色映射到 CSS 变量 `--sk-*`（`globals.css` + `tailwind.config.js`）。

## 视觉层次

```
┌─────────────────────────────┐
│  Layer 3  聊天 UI（毛玻璃）   │
├─────────────────────────────┤
│  Layer 2  渐变遮罩（可读性）  │  ← 可调「遮罩强度」
├─────────────────────────────┤
│  Layer 1b 背景图 cover       │  ← 内置 keeper-bg.png 或用户上传
├─────────────────────────────┤
│  Layer 1a 主题底色           │  ← --sk-navy-deep
└─────────────────────────────┘
```

## 自定义资源

| 类型 | 存储 | 说明 |
|------|------|------|
| 背景 | `D:\SQLlite\appearance\bg-*.png` 等 | 设置页选择或拖拽；聊天/状态窗生效 |
| Agent 头像 | `appearance/avatar-keeper-*` | 同步到 Dock、托盘 |
| 用户头像 | `appearance/avatar-user-*` | 聊天气泡 |

DB 仅存文件名；路径相对于 `appearance/` 目录。备份时拷贝整个 `D:\SQLlite\` 即可。

**Dock** 不铺全屏壁纸（保持透明），仅同步主题色与头像。

## 开发者

- `src/config/appearance.ts` — 读取/合并 preset + 用户资源
- `src/renderer/theme/apply-theme.ts` — 注入 CSS 变量
- `electron/ipc/appearance.ts` — IPC + 多窗 `appearance:changed` 广播
- 内置默认图：`public/keeper-bg.png`、`keeper-avatar.png`、`user-avatar.png`

## 相关文件

- `src/renderer/components/AppBackground.tsx`
- `src/renderer/settings/AppearancePage.tsx`
- `src/renderer/styles/globals.css`
