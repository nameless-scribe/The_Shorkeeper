# 主题系统统一（治本）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将分散的主题注入（CSS 变量 / React state / inline style）收敛为单一 `ThemeProvider`，使切换主题预设时**全应用 UI token 一致更新**；**自定义壁纸在切换预设时始终保留**。

**Architecture:** 主进程 `getAppearanceSettings()` 仍是唯一配置源；渲染进程仅一个 `ThemeProvider` 订阅 `appearance:changed` 与首次 `appearance:get`，调用 `applyTheme()` 写入 `:root` CSS 变量，并通过 Context 暴露 `AppearanceSettingsInfo`（供需读 `presetId` / `hasCustomAssets` 的组件使用）。所有颜色/渐变/阴影通过 `--sk-*` token 表达，**禁止**组件内写死 hex 或 `buildXxxGradient()` inline style。切换 `setAppearancePreset()` **只改** `ui.theme.preset_id` 与派生 veil/色板，**不触碰** `ui.theme.assets.background`。

**Tech Stack:** Electron IPC · React Context · CSS custom properties · Tailwind `keeper-*` · Vitest

**相关文档：** [UI-THEME.md](../../UI-THEME.md) · [persona-appearance-design.md](../specs/2026-07-01-persona-appearance-design.md) · 已完成 [2026-07-01-persona-appearance.md](./2026-07-01-persona-appearance.md)

**预计工期：** 2–3 天（Phase T1–T3）；Phase T4 扫尾可选 +0.5 天

---

## 产品规则（必须遵守）

| 规则 | 行为 |
|------|------|
| **自定义壁纸保留** | `setAppearancePreset(id)` **不得**清空 `ui.theme.assets.background` 或删除 `appearance/bg-*` 文件 |
| **切换预设时变什么** | 8 色 token、veil 渐变、气泡/玻璃/阴影/星空、遮罩强度默认值（无用户 override 时）、内置背景**仅当无自定义壁纸时**切换 |
| **切换预设时不变什么** | 用户上传的壁纸文件与 DB 引用；用户上传的头像；用户手动设置的 `ui.theme.veil_opacity` / `ui.theme.bg_fit` |
| **自定义壁纸下的主题感** | 通过 **veil 渐变**（左/全屏遮罩）+ **可选轻度色调层**（`--sk-bg-tint`，默认 0.2–0.3 opacity，`mix-blend-color`）体现 preset，**不替换壁纸像素** |
| **恢复内置背景** | 仅用户点击「恢复预设背景」时清除 `assets.background` |

---

## 现状问题（为何要治本）

```
主进程 appearance
    ├─ IPC appearance:changed
    ├─ applyTheme() → document CSS 变量     [路径 A]
    ├─ useAppearance() → React state      [路径 B]
    └─ MessageList inline style             [路径 C，临时补丁]
```

- 路径 A/B/C 并存，切换预设时部分组件不更新
- `tailwind.config.js` 与组件内仍有硬编码 `#30BCED`、`rgba(0,212,255,…)`（约 15+ 处）
- `AppearanceBootstrap` + `AppearancePage` + `useAppearance` 重复注册 `onChanged` / `applyTheme`
- 验收标准「主题预设切换即时生效」在自定义壁纸 + 聊天气泡场景下未稳定满足

---

## Phase 划分

| Phase | 名称 | 交付 |
|-------|------|------|
| **T1** | ThemeProvider + 去重 | 单一注入点；删 inline 补丁；测试 preset 切换保留壁纸 |
| **T2** | 扩展 token + applyTheme | preset 派生 `--sk-user-bubble` 等；CSS class 替代 inline |
| **T3** | 聊天主路径硬编码清扫 | MessageList / TitleBar / InputBar / AppBackground |
| **T4** | 设置 & 卫星面板（可选） | Settings* / Status / Dock / 图表 stroke |

---

## 文件结构（目标态）

| 文件 | 职责 |
|------|------|
| `src/renderer/theme/ThemeProvider.tsx` | Context + 订阅 IPC + 调用 `applyTheme` |
| `src/renderer/theme/apply-theme.ts` | 唯一 `:root` CSS 变量写入逻辑 |
| `src/renderer/theme/use-theme.ts` | `useTheme()` = Context consumer（替代分散的 `useAppearance` 用途） |
| `src/shared/theme-styles.ts` | 由 preset colors 生成 gradient 字符串（主进程/apply 共用） |
| `src/config/appearance.ts` | `setAppearancePreset` 保证不碰 background asset |
| `src/renderer/styles/globals.css` | `.keeper-user-bubble`、`.keeper-assistant-bubble` 等 consume `--sk-*` |
| `tailwind.config.js` | shadow/backgroundImage 仅引用 `var(--sk-*)` |

**删除或瘦身：**
- `AppearanceBootstrap.tsx` → 合并进 `ThemeProvider`
- `MessageList` 内 `buildUserBubbleGradient` inline style → 改为 class
- `AppearancePage` 内重复 `applyTheme()` → 仅依赖 Provider

---

## Phase T1：ThemeProvider + 去重

### Task T1.1：ThemeProvider 与 useTheme

**Files:**
- Create: `src/renderer/theme/ThemeProvider.tsx`
- Create: `src/renderer/theme/use-theme.ts`
- Modify: `src/renderer/main.tsx`
- Delete: `src/renderer/theme/AppearanceBootstrap.tsx`（合并后）

- [x] **Step 1: 编写 ThemeProvider**

```tsx
// src/renderer/theme/ThemeProvider.tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppearanceSettingsInfo } from '@/shared/types';
import { applyTheme } from './apply-theme';

const ThemeContext = createContext<AppearanceSettingsInfo | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceSettingsInfo | null>(null);

  useEffect(() => {
    if (!window.shorekeeper?.appearance) return undefined;

    let cancelled = false;
    window.shorekeeper.appearance.get().then((data) => {
      if (cancelled) return;
      applyTheme(data);
      setAppearance(data);
    }).catch(console.error);

    const off = window.shorekeeper.appearance.onChanged((data) => {
      applyTheme(data);
      setAppearance(data);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const value = useMemo(() => appearance, [appearance]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppearanceSettingsInfo | null {
  return useContext(ThemeContext);
}
```

- [x] **Step 2: main.tsx 替换 AppearanceBootstrap**

```tsx
// src/renderer/main.tsx — 将 AppearanceBootstrap 换为 ThemeProvider
import { ThemeProvider } from './theme/ThemeProvider';

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RuntimeGate>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </RuntimeGate>
    </ErrorBoundary>
  </React.StrictMode>,
);
```

- [x] **Step 3: 将 `useAppearance` 改为 re-export（兼容过渡）**

```tsx
// src/renderer/theme/use-appearance.ts
export { useTheme as useAppearance } from './use-theme';
```

- [x] **Step 4: 运行 typecheck**

Run: `pnpm typecheck`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/theme/ThemeProvider.tsx src/renderer/theme/use-theme.ts src/renderer/main.tsx src/renderer/theme/use-appearance.ts
git commit -m "refactor(theme): add ThemeProvider as single injection point"
```

---

### Task T1.2：预设切换保留自定义壁纸（测试 + 保证）

**Files:**
- Modify: `src/config/appearance.ts`
- Test: `src/config/__tests__/appearance-preset-assets.test.ts`

- [x] **Step 1: 写失败测试**

```typescript
// src/config/__tests__/appearance-preset-assets.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};

vi.mock('../../db/app-settings', () => ({
  getSetting: vi.fn((key: string) => store[key] ?? null),
  setSetting: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  getJsonSetting: vi.fn((key: string) => {
    const raw = store[key];
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  }),
  setJsonSetting: vi.fn((key: string, value: unknown) => {
    store[key] = JSON.stringify(value);
  }),
}));

vi.mock('../appearance-assets', () => ({
  getThemeAssetsRecord: vi.fn(() => JSON.parse(store['ui.theme.assets'] ?? '{}')),
  resolveAppearanceAssetUrl: vi.fn((rel: string | null) =>
    rel ? `sk-asset://local/${rel}` : null,
  ),
}));

import { setAppearancePreset, getAppearanceSettings } from '../appearance';

describe('setAppearancePreset preserves custom background', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    store['ui.theme.assets'] = JSON.stringify({ background: 'bg-user-abc.png' });
  });

  it('keeps background filename when switching preset', () => {
    setAppearancePreset('midnight');
    const info = getAppearanceSettings();
    expect(info.presetId).toBe('midnight');
    expect(info.assets.backgroundUrl).toBe('sk-asset://local/bg-user-abc.png');
  });
});
```

- [x] **Step 2: 运行测试确认通过或补实现**

Run: `pnpm test src/config/__tests__/appearance-preset-assets.test.ts`  
Expected: PASS（当前 `setAppearancePreset` 已只写 preset_id；若失败则在 `setAppearancePreset` 显式注释/断言不调用 `clearAppearanceAsset`）

- [x] **Step 3: 在 `setAppearancePreset` 加防护注释与断言（可选）**

```typescript
export function setAppearancePreset(presetId: string): AppearanceSettingsInfo {
  const preset = getThemePreset(presetId);
  const assetsBefore = getThemeAssetsRecord();
  setSetting(PRESET_KEY, preset.id);
  const assetsAfter = getThemeAssetsRecord();
  if (assetsBefore.background && !assetsAfter.background) {
    throw new Error('setAppearancePreset must not clear custom background');
  }
  return getAppearanceSettings();
}
```

- [ ] **Step 4: Commit**

```bash
git add src/config/appearance.ts src/config/__tests__/appearance-preset-assets.test.ts
git commit -m "test(theme): preset switch preserves custom wallpaper"
```

---

### Task T1.3：移除 AppearancePage 重复 applyTheme

**Files:**
- Modify: `src/renderer/settings/AppearancePage.tsx`

- [x] **Step 1: 删除 `applyTheme` import 与 runAction/onChanged 内调用**

`runAction` 仅 `setInfo(result)`；主题由 `ThemeProvider` 统一应用。

- [ ] **Step 2: 手动验证**

1. `pnpm dev`
2. 上传自定义背景 → 切换「午夜紫」→ 壁纸仍在、气泡/按钮变色

- [ ] **Step 3: Commit**

```bash
git add src/renderer/settings/AppearancePage.tsx
git commit -m "refactor(theme): remove duplicate applyTheme from AppearancePage"
```

---

## Phase T2：扩展 token + CSS class

### Task T2.1：applyTheme 写入完整 token 集

**Files:**
- Modify: `src/shared/theme-styles.ts`
- Modify: `src/renderer/theme/apply-theme.ts`
- Modify: `src/renderer/styles/globals.css`
- Test: `src/renderer/theme/__tests__/apply-theme.test.ts`

- [x] **Step 1: 扩展 theme-styles 导出**

```typescript
// src/shared/theme-styles.ts — 新增
export function buildThemeCssVars(colors: ThemeColorTokens): Record<string, string> {
  const cyanRgb = hexToRgbChannels(colors.cyan);
  return {
    '--sk-user-bubble': buildUserBubbleGradient(colors),
    '--sk-glass': buildGlassGradient(colors),
    '--sk-stars-image': buildStarsBackground(cyanRgb, hexToRgbChannels(colors.iceDeep)),
    '--sk-shadow-accent': `0 0 12px rgb(${cyanRgb} / 0.65)`,
    '--sk-shadow-accent-sm': `0 0 6px rgb(${cyanRgb} / 0.35)`,
    '--sk-bg-tint-opacity': '0.25', // 自定义壁纸色调层；后续可入库
  };
}
```

- [x] **Step 2: applyTheme 循环写入 buildThemeCssVars**

```typescript
// apply-theme.ts — 在写入 COLOR_KEYS 后
const derived = buildThemeCssVars(info.colors);
for (const [key, value] of Object.entries(derived)) {
  root.style.setProperty(key, value);
}
// 无自定义背景时才更新 --sk-bg-image
if (!info.assets.backgroundUrl) {
  root.style.setProperty('--sk-bg-image', `url("${publicAssetUrl(info.assets.builtinBackground)}")`);
}
// 有自定义背景时保留现有 --sk-bg-image（由上次 apply 或 assets.backgroundUrl 设置）
if (info.assets.backgroundUrl) {
  root.style.setProperty('--sk-bg-image', `url("${info.assets.backgroundUrl}")`);
}
```

- [x] **Step 3: globals.css 新增 consume class**

```css
.keeper-user-bubble {
  background: var(--sk-user-bubble);
}

.keeper-assistant-bubble {
  background-image: var(--sk-glass);
}

.keeper-bg-tint {
  background-color: rgb(var(--sk-navy-deep-rgb));
  opacity: var(--sk-bg-tint-opacity, 0.25);
  mix-blend-mode: color;
}
```

- [x] **Step 4: 写 apply-theme 单测（jsdom）**

```typescript
// src/renderer/theme/__tests__/apply-theme.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { applyTheme } from '../apply-theme';
import type { AppearanceSettingsInfo } from '@/shared/types';

const base: AppearanceSettingsInfo = {
  presetId: 'midnight',
  presetName: '午夜紫',
  presets: [],
  colors: {
    navyDeep: '#1a1028',
    navy: '#2d1b4e',
    ice: '#E8E0F0',
    iceDeep: '#c084fc',
    cyan: '#e879a8',
    cyanDim: '#c084fc',
    silver: '#B8A8C8',
    silverLight: '#E8E0F0',
  },
  assets: {
    backgroundUrl: 'sk-asset://local/bg-test.png',
    keeperAvatarUrl: '',
    userAvatarUrl: '',
    builtinBackground: 'keeper-bg.png',
    builtinKeeperAvatar: 'keeper-avatar.png',
    builtinUserAvatar: 'user-avatar.png',
  },
  veil: { chat: 'none', status: 'none' },
  hasCustomAssets: true,
  backgroundFit: 'cover',
  veilOpacity: 0.85,
  showStars: true,
};

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('sets user bubble gradient from preset colors', () => {
    applyTheme(base);
    const bubble = getComputedStyle(document.documentElement).getPropertyValue('--sk-user-bubble');
    expect(bubble).toContain('#e879a8');
  });

  it('keeps custom background url in --sk-bg-image', () => {
    applyTheme(base);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--sk-bg-image');
    expect(bg).toContain('bg-test.png');
  });
});
```

Run: `pnpm test src/renderer/theme/__tests__/apply-theme.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/shared/theme-styles.ts src/renderer/theme/apply-theme.ts src/renderer/styles/globals.css src/renderer/theme/__tests__/apply-theme.test.ts
git commit -m "feat(theme): derive full CSS token set in applyTheme"
```

---

### Task T2.2：MessageList 改用 CSS class（删 inline style）

**Files:**
- Modify: `src/renderer/components/MessageList.tsx`

- [x] **Step 1: 用户气泡**

```tsx
<div className="keeper-user-bubble rounded-2xl rounded-tr-md px-4 py-2.5 text-sm leading-relaxed text-white shadow-cyanSm">
```

- [x] **Step 2: Agent 气泡**

```tsx
<div className="keeper-assistant-bubble keeper-glass-soft rounded-2xl rounded-tl-md border border-keeper-cyan/20 ...">
```

- [x] **Step 3: 删除 `useMemo` + `buildUserBubbleGradient` import**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/MessageList.tsx
git commit -m "refactor(theme): message bubbles use CSS token classes"
```

---

## Phase T3：聊天主路径硬编码清扫

### Task T3.1：tailwind shadow 全面 token 化

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/renderer/styles/globals.css`

- [x] **Step 1: tailwind boxShadow 已用 `rgb(var(--sk-cyan-rgb)/…)` — 新增 utility class**

```css
.shadow-accent { box-shadow: var(--sk-shadow-accent); }
.shadow-accent-sm { box-shadow: var(--sk-shadow-accent-sm); }
```

- [x] **Step 2: 替换组件内 `shadow-[0_0_12px_rgba(48,188,237,0.65)]` 等为 `shadow-accent`**

优先文件：
- `src/renderer/components/AgentWorkflowBar.tsx`
- `src/renderer/settings/SettingsSidebar.tsx`
- `src/renderer/settings/components/SettingsSegmented.tsx`
- `src/renderer/settings/components/settings-ui.tsx`
- `src/renderer/settings/ModelPage.tsx`
- `src/renderer/settings/components/PluginCard.tsx`

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.js src/renderer/styles/globals.css src/renderer/components/AgentWorkflowBar.tsx src/renderer/settings/
git commit -m "refactor(theme): replace hardcoded accent shadows with tokens"
```

---

### Task T3.2：AppBackground 色调层 token 化

**Files:**
- Modify: `src/renderer/components/AppBackground.tsx`

- [x] **Step 1: 使用 class 替代 inline**

```tsx
{hasCustomBg && <div className="keeper-bg-tint pointer-events-none absolute inset-0" aria-hidden />}
```

- [x] **Step 2: 无自定义壁纸时不渲染 tint 层**

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/AppBackground.tsx
git commit -m "refactor(theme): custom wallpaper tint via CSS token"
```

---

### Task T3.3：AppearancePage 文案与验收

**Files:**
- Modify: `src/renderer/settings/AppearancePage.tsx`
- Modify: `docs/UI-THEME.md`

- [x] **Step 1: SettingsIntro 文案（最终版）**

「主题预设会切换配色、气泡、遮罩与强调色。**已上传的自定义壁纸会保留**；若需恢复内置立绘，请点「恢复预设背景」。」

- [x] **Step 2: 更新 UI-THEME.md「切换预设」小节**

- [ ] **Step 3: Commit**

```bash
git add src/renderer/settings/AppearancePage.tsx docs/UI-THEME.md
git commit -m "docs(theme): clarify preset switch keeps custom wallpaper"
```

---

## Phase T4（可选）：设置 & 卫星面板

| 文件 | 改动 | 状态 |
|------|------|------|
| `src/renderer/schedule/TokenUsageLineChart.tsx` | `stroke` / `fill` 改读 `useTheme().colors` | ✅ |
| `src/renderer/status/StatusPage.tsx` | accent drop-shadow + emerald 状态点 | ✅ |
| `src/renderer/components/PermissionDialog.tsx` | `bg-[#0d1630]` → `bg-keeper-navyDeep` 等 | ✅ |
| `DockStatusBar` / `PluginCard` | emerald 状态阴影 → `.shadow-emerald-*` | ✅ |

---

## 验收清单（手动）

- [ ] 无自定义壁纸：切换 shorekeeper → midnight → dawn，背景图、气泡、veil、按钮 **全部**明显变化
- [ ] **有自定义壁纸**：切换三预设，**壁纸不变**，veil/气泡/按钮/色调层变化
- [ ] 「恢复预设背景」后，切换预设会换回 preset 内置 `keeper-bg.png`
- [ ] 多窗：聊天 + 状态 + Dock 同步（`appearance:changed` 广播）
- [ ] `pnpm test` 全绿；`pnpm build` 通过
- [ ] 打包安装后自定义壁纸 + 预设切换仍正常（`sk-asset://`）

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 全界面视觉变化大 | 分 Phase 合并；T1 行为应接近现状 |
| CSS 变量在 Electron 不刷新 | 单测 + 手动切 preset；必要时 `ThemeProvider` 在 preset 变化时 `key={presetId}` 强制子树 remount（最后手段） |
| 对比度/accessibility | midnight/dawn 气泡与文字对比人工看一眼 |
| 回滚 | 每 Phase 独立 commit，可 revert 单 Phase |

---

## Spec 覆盖自检

| 需求 | Task |
|------|------|
| 单一 ThemeProvider | T1.1 |
| 自定义壁纸保留 | T1.2、T2.1 applyTheme 分支 |
| 去 inline 补丁 | T2.2 |
| 全 token 化 | T2.1、T3.1 |
| 文档 | T3.3 |
| 测试 | T1.2、T2.1 |

---

## 实施顺序建议

**T1 → T2 → T3 →（可选 T4）**

每 Phase 结束运行：`pnpm typecheck && pnpm test && pnpm build`
