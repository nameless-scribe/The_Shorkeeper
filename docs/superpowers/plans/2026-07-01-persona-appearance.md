# 自定义人设与外观 Implementation Plan

> **Status:** 已完成（2026-07-01）  
> **Spec:** [2026-07-01-persona-appearance-design.md](../specs/2026-07-01-persona-appearance-design.md)

**Goal:** 设置页可编辑核心人设并切换主题/上传本地背景与头像，配置持久化于 `app_settings` + `appearance/`。

## 交付摘要

### P1 人设
- 修复 `ensurePersonaUpToDate()`：`custom` / 无 version 有 prompt 不覆盖
- `src/config/persona.ts` + `electron/ipc/persona.ts`
- 设置页 **人格与记忆 → 人设**（`PersonaPage.tsx`）
- 状态面板展示 `displayName`

### P2–P3 外观
- 3 套主题预设（`src/config/themes/`）
- CSS 变量 + Tailwind `keeper-*` 映射
- `appearance` IPC、多窗 `appearance:changed` 广播
- 设置页 **个性化 → 外观**：预设、本机选择/拖拽背景、遮罩滑块、头像
- Dock 保持透明，同步色板与头像；托盘优先自定义 keeper 头像

### P4 文档
- `docs/UI-THEME.md`、`README.md`、`docs/DESIGN.md` 已更新

## 验收

- [x] 人设编辑保存 → 下条消息生效（`invalidateStableContext`）
- [x] 重启后 custom 人设保留
- [x] 主题预设切换即时生效
- [x] 背景/头像本地上传与恢复
- [x] Vitest：`persona-seed`、`persona`、`appearance`

## 主要文件

| 模块 | 路径 |
|------|------|
| 人设配置 | `src/config/persona.ts` |
| 外观配置 | `src/config/appearance.ts`, `appearance-assets.ts` |
| 主题应用 | `src/renderer/theme/apply-theme.ts` |
| 设置 UI | `PersonaPage.tsx`, `AppearancePage.tsx` |
