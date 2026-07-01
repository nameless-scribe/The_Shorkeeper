# UI 主题与外观

运行时换肤：设置 → **个性化 → 外观**。内置 **9 套**主题预设（下拉选择），支持本地上传背景与头像。

## 主题预设

| ID | 名称 | 说明 |
|----|------|------|
| `shorekeeper` | 守岸人 · 星空 | 默认深蓝 + cyan |
| `midnight` | 午夜紫 | 深紫 + 粉紫强调 |
| `dawn` | 拂晓 | 略浅背景 + 暖色 accent |
| `deep-sea` | 深海青 | 墨蓝底 + 青绿 accent |
| `forest` | 晨雾绿 | 深林底 + 薄荷绿 accent |
| `sakura` | 桜夜 | 暗紫红底 + 樱花粉 accent |
| `twilight` | 薄暮紫 | 暮光紫调 + 淡紫 accent |
| `slate` | 板岩灰 | 灰蓝底 + 天蓝 accent |
| `neon` | 霓虹脉冲 | 高对比暗底 + 电光 cyan |

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

- `src/config/themes/` — 主题预设定义（`listThemePresets()`）
- `src/config/appearance.ts` — 读取/合并 preset + 用户资源；`setAppearancePreset` 不删除自定义壁纸
- `src/renderer/theme/ThemeProvider.tsx` — React Context；订阅 `appearance:changed`，调用 `applyTheme`
- `src/renderer/theme/apply-theme.ts` — 唯一 `:root` CSS 变量写入逻辑
- `src/shared/theme-styles.ts` — 由 preset colors 生成 gradient / shadow / tint 字符串
- `electron/ipc/appearance.ts` — IPC + 多窗 `appearance:changed` 广播
- `electron/protocol/appearance-assets.ts` — `sk-asset://local/<file>` 协议
- 内置默认图：`public/keeper-bg.png`、`keeper-avatar.png`、`user-avatar.png`

## 切换主题预设

切换预设时**会变化**：

- 8 色 token（`--sk-*`）与 Tailwind `keeper-*`
- veil 渐变、气泡/玻璃/星空/阴影
- 内置背景图（**仅当未上传自定义壁纸时**）

切换预设时**不会变化**：

- 用户上传的壁纸文件与 DB 中的 `ui.theme.assets.background`
- 用户上传的头像
- 用户手动设置的遮罩强度（`ui.theme.veil_opacity`）与背景适配（`ui.theme.bg_fit`）

有自定义壁纸时，preset 的「主题感」通过 **veil 渐变** + **色调层**（`.keeper-bg-tint`，`--sk-bg-tint-opacity`）体现，不替换壁纸像素。

恢复内置立绘：设置 → 外观 → **恢复预设背景**（会清除 `assets.background` 引用）。

组件应使用 CSS 类（如 `.keeper-user-bubble`、`.shadow-accent`）或 `keeper-*` Tailwind，避免硬编码 `#30BCED` / `rgba(48,188,237,…)`。

## 相关文件

- `src/renderer/components/AppBackground.tsx`
- `src/renderer/settings/AppearancePage.tsx`
- `src/renderer/styles/globals.css`
