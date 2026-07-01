# 自定义人设与外观（换肤）设计

> **版本：** 0.1.0  
> **日期：** 2026-07-01  
> **状态：** 已实现（2026-07-01）  
> **关联：** [DESIGN.md](../../DESIGN.md) · [UI-THEME.md](../../UI-THEME.md) · [DATABASE.md](../../DATABASE.md)

---

## 1. 背景与动机

### 1.1 现状

| 能力 | 当前实现 | 问题 |
|------|----------|------|
| **核心人设** | `app_settings.persona.system_prompt`，由 `stable-context.ts` 每轮注入 | 无设置页；手动改 DB 后可能被启动时的 `ensurePersonaUpToDate()` 覆盖 |
| **Worldbook** | `worldbook_entries`，关键词命中后注入 `【世界观 / 背景】` | 有 UI，但**不是**每轮生效的主身份，易与用户预期的「人设」混淆 |
| **用户画像** | `user_profile`，注入 `【用户画像】` | 有 UI，描述**用户**而非 Agent 角色 |
| **技能** | `skills/*/SKILL.md` 片段 | 有 UI，偏能力与行为扩展 |
| **外观** | `tailwind.config.js` + `globals.css` + `public/*.png` 硬编码 | 无运行时换肤；只能改源码或替换静态资源并重启 |

### 1.2 目标

1. **人设可编辑、可持久、可恢复默认**，保存后**下一轮对话立即生效**（无需重启）。
2. **外观可切换预设主题**，并支持**自定义背景图 / 头像**（本地文件），多窗口视觉一致。
3. 在设置 UI 中**明确区分**：人设 / Worldbook / 用户画像，降低认知成本。
4. 保持**本地优先**：配置存 SQLite + 本地文件，不上传云端。

### 1.3 非目标（本阶段不做）

- 多人设槽位切换（如 SillyTavern 多角色卡）—— 后续可扩展
- 云端主题市场 / 社区分享
- Live2D 模型换肤（M8 桌宠范畴，本文档仅覆盖 2D UI）
- 对话风格 `gentle | default | formal` 的完整实现（可预留字段，Phase 2 可选）
- CSS 编辑器 / 逐色高级调色（Phase 1 仅预设 + 图片）

---

## 2. 概念模型

### 2.1 与人设相关的三层

```
┌─────────────────────────────────────────────────────────────┐
│  Layer A · 核心人设 (Persona)                                │
│  每轮必注入 · 定义「你是谁、怎么说话、当前场景、工具准则」      │
│  存储：app_settings.persona.*                                 │
│  设置页：人格与记忆 → 人设                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓ 每轮
┌─────────────────────────────────────────────────────────────┐
│  Layer B · 技能 / 工具说明 (Skills + Tool Guide)             │
│  每轮必注入 · 能力与白名单                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓ 每轮（有数据时）
┌─────────────────────────────────────────────────────────────┐
│  Layer C · 动态上下文                                        │
│  用户画像 · 会话摘要 · 记忆 · Worldbook(命中时) · RAG · 好感度 │
└─────────────────────────────────────────────────────────────┘
```

**Worldbook 仍是 Layer C**，设置页文案需强调：「按需触发的背景资料，不能替代上方核心人设」。

### 2.2 外观模型

```
ThemePreset (内置 JSON)
    ↓ 用户选择
ActiveTheme (app_settings.ui.theme)
    ↓ 可选覆盖
CustomAssets (本地 appearance/ 目录下的图片)
    ↓ 应用
Renderer: CSS Variables + 动态 background-image / img src
```

---

## 3. 人设（Persona）设计

### 3.1 数据存储

沿用 `app_settings` KV，扩展键名：

| Key | 类型 | 说明 |
|-----|------|------|
| `persona.system_prompt` | string | 核心 system prompt 正文 |
| `persona.version` | string | 版本标记，见 §3.2 |
| `persona.display_name` | string | 可选，UI 展示用角色名（默认「守岸人」） |
| `persona.updated_at` | string | ISO 时间，仅 UI 展示（或与 `app_settings.updated_at` 复用） |

不新增表；与现有 seed 机制兼容。

### 3.2 版本与升级策略（修复现有 Bug）

**现状问题：** `ensurePersonaUpToDate()` 在 `persona.version !== 'shorekeeper-v2'` 时**无条件**覆盖 prompt，与注释「不覆盖用户自定义版本」矛盾。

**新规则：**

| `persona.version` 值 | 启动时行为 |
|----------------------|------------|
| `shorekeeper-v2`（与内置一致） | 不写入 |
| `shorekeeper-v1` 等旧内置版本 | **升级**至当前内置 prompt + version |
| `custom` | **永不**自动覆盖 prompt |
| 缺失 version 但有 prompt | 视为 `custom`，不覆盖 |
| 缺失 version 且无 prompt | 写入内置 seed |

```typescript
// 伪代码
function ensurePersonaUpToDate(db) {
  const version = get('persona.version');
  const prompt = get('persona.system_prompt');

  if (version === 'custom') return false;
  if (version === BUILTIN.version) return false;
  if (!version && prompt?.trim()) return false; // 用户曾手改 DB

  if (!version && !prompt?.trim()) {
    writeBuiltin(); return true;
  }
  if (version?.startsWith('shorekeeper-') && version !== BUILTIN.version) {
    writeBuiltin(); return true;
  }
  return false;
}
```

**用户操作「恢复默认」：** 显式写入内置 `SHOREKEEPER_PERSONA` 并将 version 设为 `shorekeeper-v2`（非 `custom`），以便后续随应用升级。

### 3.3 后端模块

```
src/config/persona.ts          # getPersonaSettings / setPersona / resetPersona
electron/ipc/persona.ts        # persona:get / persona:set / persona:reset
```

**`setPersona` 行为：**

1. 校验 `systemPrompt` 非空，长度上限 **16_000 字符**（防止误粘贴超大文本拖垮 context）。
2. 写入 `persona.system_prompt`，`persona.version = 'custom'`。
3. 可选写入 `persona.display_name`。
4. 调用 `invalidateStableContext()` 清缓存。
5. 返回最新 `PersonaSettingsInfo`。

**`resetPersona` 行为：**

1. 写入 `SHOREKEEPER_PERSONA` 全文 + version = 内置 version。
2. `invalidateStableContext()`。
3. 不删除 Worldbook / 用户画像。

### 3.4 IPC 与类型

```typescript
// src/shared/types.ts
export interface PersonaSettingsInfo {
  systemPrompt: string;
  version: string;           // 'custom' | 'shorekeeper-v2' | ...
  displayName: string;
  isCustom: boolean;         // version === 'custom'
  builtinVersion: string;    // 当前应用内置版本，供 UI 提示升级
  charCount: number;
  updatedAt: number | null;
}

export interface PersonaSettingsPatch {
  systemPrompt?: string;
  displayName?: string;
}
```

```typescript
// preload
persona: {
  get: (): Promise<PersonaSettingsInfo>;
  set: (patch: PersonaSettingsPatch): Promise<PersonaSettingsInfo>;
  reset: (): Promise<PersonaSettingsInfo>;
}
```

### 3.5 设置页 UI — `PersonaPage`

**位置：** 设置 Drawer → 侧栏「人格与记忆」→ **人设**（新增，放在「用户信息」之上）。

**布局：**

| 区块 | 内容 |
|------|------|
| 说明 | 核心人设每轮对话都会注入；Worldbook 仅在触发词命中时补充背景 |
| 角色名 | 单行输入 `displayName` |
| System Prompt | 大文本框（monospace），显示字数 / 16000 上限 |
| 状态条 | `自定义` / `内置 v2` 徽章；上次保存时间 |
| 操作 | **保存** · **恢复默认**（二次确认） · **在 Worldbook 中管理背景**（跳转 tab） |

**交互：**

- 未保存离开 tab 时提示（可选 Phase 2）。
- 保存成功 toast：「人设已更新，下一条消息起生效」。
- 「恢复默认」Dialog：说明将覆盖当前 prompt，Worldbook 不受影响。

**与 Worldbook 的文案区分（设置 Intro）：**

> 人设决定 Agent **每一轮**如何扮演与回应；Worldbook 在对话**提到相关词**时注入额外背景。两者可同时使用，但不可替代。

### 3.6 Prompt 注入链路（不变，仅补缓存失效）

```
agent:send
  → orchestrator.run()
  → buildSystemPromptParts()
  → getStableSystemPrefix()
       → loadPersonaPrompt()  // 读 DB
       → formatSkillsForPrompt()
  → ... dynamic blocks ...
```

**缓存：** `getStableSystemPrefix()` 已有内存缓存；`persona:set` / `persona:reset` / `skills:toggle` 均需 `invalidateStableContext()`。

### 3.7 测试要点

| 用例 | 期望 |
|------|------|
| 保存 custom prompt | 下轮 `getStableSystemPrefix()` 含新文本 |
| version=custom 启动 | `ensurePersonaUpToDate` 不覆盖 |
| reset | prompt 等于 `SHOREKEEPER_PERSONA`，version 为内置 |
| 空 prompt 保存 | IPC 拒绝，返回错误 |
| invalidate 后缓存 | 两次 get 在 invalidate 后内容不同 |

---

## 4. 外观（Appearance / 换肤）设计

### 4.1 设计原则

1. **预设优先**：80% 用户只选主题即可，无需调 CSS。
2. **CSS 变量驱动**：Tailwind `keeper-*` 逐步映射到 `var(--sk-*)`，避免双份色值。
3. **资源本地化**：自定义图片存应用数据目录，DB 只存相对路径或 preset id。
4. **多窗口同步**：chat / status / schedule / dock 共用同一主题配置；变更后广播 `appearance:changed`。

### 4.2 主题预设

内置 3 套（JSON 静态文件 + 默认 `shorekeeper`）：

| ID | 名称 | 说明 |
|----|------|------|
| `shorekeeper` | 守岸人 · 星空 | 当前默认，深蓝 + cyan |
| `midnight` | 午夜紫 | 深紫 `#1a1028` + 粉紫强调（贴近 DESIGN.md §8.1 草案） |
| `dawn` | 拂晓 | 略浅背景 + 暖色 accent，低对比阅读向 |

**预设文件路径：**

```
src/config/themes/
  shorekeeper.json
  midnight.json
  dawn.json
  index.ts              # listThemePresets(), getThemePreset(id)
```

**预设 JSON 结构：**

```typescript
export interface ThemePreset {
  id: string;
  name: string;
  description?: string;
  colors: {
    navyDeep: string;
    navy: string;
    ice: string;
    iceDeep: string;
    cyan: string;
    cyanDim: string;
    silver: string;
    silverLight: string;
  };
  backgrounds: {
    /** 内置资源相对 public/ 或打包路径 */
    scene?: string;       // 全幅背景，如 'keeper-bg.png'
    sceneStatus?: string; // status 窗裁剪参数可写在 preset
    stars?: boolean;      // 是否叠加星空粒子层
  };
  veil: {
    chat: string;   // CSS gradient 字符串
    status: string;
  };
  defaultAvatars: {
    keeper: string;  // 'keeper-avatar.png'
    user: string;
  };
}
```

### 4.3 用户配置存储

| Key | 类型 | 说明 |
|-----|------|------|
| `ui.theme.preset_id` | string | 当前预设 id，默认 `shorekeeper` |
| `ui.theme.custom` | JSON string | 可选，覆盖 preset 的 colors / 资源路径 |
| `ui.theme.assets` | JSON string | 用户上传文件映射，见下 |

**`ui.theme.assets` 示例：**

```json
{
  "background": "appearance/bg-abc123.png",
  "keeperAvatar": "appearance/avatar-keeper.png",
  "userAvatar": null
}
```

路径相对于 **`getAppearanceDir()`**：

```typescript
// src/config/paths.ts
export function getAppearanceDir(): string {
  return path.join(getDatabaseDir(), 'appearance');
}
```

与 workspace 同级，便于备份整个 `D:\SQLlite\`。

**文件约束：**

| 项 | 限制 |
|----|------|
| 格式 | png, jpg, jpeg, webp |
| 单文件大小 | ≤ 8 MB |
| 背景图 | 建议 ≥ 1280×720；过大时 UI 警告但不阻止 |
| 头像 | 建议正方形；UI 圆形裁剪 |

### 4.4 后端模块

```
src/config/appearance.ts       # get/set/resolveAppearanceSettings
electron/ipc/appearance.ts   # appearance:* IPC + 文件 pick/copy
```

**解析优先级（合并逻辑）：**

```
effectiveTheme = merge(
  getThemePreset(preset_id),
  parseJson(ui.theme.custom),
  resolveAssetPaths(ui.theme.assets)  // 用户文件覆盖 preset 默认图
)
```

**IPC：**

```typescript
export interface AppearanceSettingsInfo {
  presetId: string;
  presetName: string;
  presets: ThemePresetSummary[];  // 列表供 UI 选择
  colors: ThemePreset['colors'];
  assets: {
    backgroundUrl: string | null;   // file:// 或 dev server URL
    keeperAvatarUrl: string;
    userAvatarUrl: string;
  };
  hasCustomAssets: boolean;
}

export interface AppearanceSettingsPatch {
  presetId?: string;
}

// 文件操作
appearance: {
  get: (): Promise<AppearanceSettingsInfo>;
  setPreset: (presetId: string): Promise<AppearanceSettingsInfo>;
  pickBackground: (): Promise<AppearanceSettingsInfo | null>;
  pickKeeperAvatar: (): Promise<AppearanceSettingsInfo | null>;
  pickUserAvatar: (): Promise<AppearanceSettingsInfo | null>;
  clearAsset: (slot: 'background' | 'keeperAvatar' | 'userAvatar'): Promise<AppearanceSettingsInfo>;
  onChanged: (cb: (info: AppearanceSettingsInfo) => void) => () => void;
}
```

**`pickBackground` 流程：**

1. `dialog.showOpenDialog`（主进程），过滤图片。
2. 复制到 `appearance/`（文件名 `bg-{uuid}.ext`，避免冲突）。
3. 更新 `ui.theme.assets.background`；删除被替换的旧文件（若非内置）。
4. `broadcastAppearanceChanged()` 向所有 BrowserWindow 发 `appearance:changed`。
5. 返回最新 `AppearanceSettingsInfo`。

### 4.5 渲染层应用

#### 4.5.1 启动时 hydrate

```
src/renderer/theme/apply-theme.ts
src/renderer/theme/ThemeProvider.tsx   # 可选：根组件包裹
```

**`applyTheme(info: AppearanceSettingsInfo)`：**

1. `document.documentElement.dataset.theme = presetId`
2. 对每个 color token：`root.style.setProperty('--sk-cyan', colors.cyan)` …
3. 更新 CSS 变量 `--sk-bg-image: url(...)`
4. 写入 `sessionStorage` 缓存，减少首屏闪烁（可选）

#### 4.5.2 CSS 变量（globals.css 迁移）

```css
:root,
:root[data-theme='shorekeeper'] {
  --sk-navy-deep: #0a1128;
  --sk-navy: #274690;
  --sk-ice: #e1e9f0;
  --sk-cyan: #30bced;
  /* ... */
  --sk-bg-image: url('/keeper-bg.png');
  --sk-veil-chat: linear-gradient(...);
}

.keeper-scene {
  background-color: var(--sk-navy-deep);
  background-image: var(--sk-bg-image);
}
```

**Tailwind 迁移策略（渐进）：**

```javascript
// tailwind.config.js — Phase 1 仅改核心色
colors: {
  keeper: {
    navyDeep: 'var(--sk-navy-deep)',
    cyan: 'var(--sk-cyan)',
    // ...
  },
}
```

现有 `bg-keeper-cyan` 等 class **无需改组件**，换变量即可换肤。

#### 4.5.3 组件改动清单

| 文件 | 改动 |
|------|------|
| `AppBackground.tsx` | 移除硬编码 class 色值依赖；veil 用 CSS var |
| `AgentAvatar.tsx` / `UserAvatar.tsx` | `src` 从 `useAppearance()` hook 读取 |
| `public-assets.ts` | 保留为**内置 fallback** |
| `electron/tray.ts` | 优先读 `appearance/keeperAvatar`，否则内置 png |
| 各 Window 入口 | 挂载时 `appearance.get()` + 订阅 `onChanged` |

**自定义背景 URL：** Electron 生产环境用 `file://` + 绝对路径；开发环境可走 `appearance:getAssetUrl(relativePath)` IPC 返回可加载 URL。

### 4.6 设置页 UI — `AppearancePage`

**位置：** 设置 Drawer → 侧栏新增分组 **「个性化」** → **外观**

| 区块 | 内容 |
|------|------|
| 主题预设 | 横向卡片 3 列：缩略色块 + 名称；选中高亮 |
| 背景 | 16:9 预览区 · **从本机选择** · 拖拽到预览区 · **恢复预设背景** |
| 遮罩强度 | 滑块 0–100（调节左侧阅读遮罩透明度，保证自定义图仍可读） |
| 头像 | Keeper / User 两列预览 + 更换 + 恢复 |
| 说明 | 外观仅影响 UI，不改变 Agent 人格 |

**实时预览：** 选预设后立即 `setPreset`；上传背景成功后立即全窗生效，无需单独保存。

### 4.7 用户上传背景图（专项）

本节展开「用户从本机选一张图作为聊天/状态窗背景」的完整方案。**不引用网络 URL**，仅本地文件；与文档导入（`documents:import`）模式一致，由主进程选文件并复制到应用数据目录。

#### 4.7.1 用户流程

```
设置 → 外观 → 背景
  ├─ 点击「从本机选择」→ 系统文件对话框
  ├─ 或将图片拖拽到预览区（Renderer 把路径交给 Main，见 §4.7.4）
  └─ 成功后聊天窗 / 状态窗背景即时替换；重启后仍生效
```

#### 4.7.2 端到端数据流

```
用户磁盘: D:\Pictures\my-wallpaper.jpg
       │
       ▼  showOpenDialog / 拖拽 path
Main: appearance:importBackground(sourcePath)
       │
       ├─ validateExtension / size / magic bytes
       ├─ copy → D:\SQLlite\appearance\bg-{uuid}.jpg
       ├─ delete 旧 bg-* 文件（若存在）
       ├─ app_settings.ui.theme.assets = { "background": "appearance/bg-xxx.jpg" }
       └─ broadcast appearance:changed
       │
       ▼
Renderer: applyTheme()
       └─ --sk-bg-image: url('file:///D:/SQLlite/appearance/bg-xxx.jpg')
          + 保留 preset 的 veil 渐变（左侧可读性）
```

**要点：**

- DB **只存相对路径** `appearance/bg-xxx.jpg`，不存用户原始路径（避免盘符变更、隐私泄露）。
- 图片**复制**进应用目录，不创建 symlink；卸载/备份时拷贝整个 `D:\SQLlite\` 即可带走。
- **预设主题色**仍生效；用户图只替换 Layer 1b 立绘层，不自动改 cyan/navy 色板。
- **遮罩层（veil）始终保留**；用户图再亮也不会让聊天气泡不可读（见 §4.7.6）。

#### 4.7.3 主进程实现

```typescript
// src/config/appearance-assets.ts

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES = 8 * 1024 * 1024;

export async function importBackgroundAsset(sourcePath: string): Promise<string> {
  // 1. path.resolve + 必须在用户可读范围（任意用户选中的文件即可）
  // 2. stat size ≤ 8MB
  // 3. ext ∈ ALLOWED_EXT
  // 4. 可选：读文件头 magic number，防伪装扩展名
  // 5. ensureDir(getAppearanceDir())
  // 6. copyFile → appearance/bg-{uuid}{ext}
  // 7. removePreviousBackgroundAsset()  // 仅删 appearance/bg-* 旧文件
  // 8. patch assets.background，persist app_settings
  // 9. return relativePath
}

export function resolveAssetUrl(relativePath: string): string {
  const abs = path.join(getAppearanceDir(), path.basename(relativePath));
  // 防穿越：realpath 必须在 getAppearanceDir() 下
  return pathToFileURL(abs).href;  // file:///...
}
```

**IPC 签名（与 pick 合并）：**

```typescript
// 打开对话框（无参）
appearance:pickBackground(): Promise<AppearanceSettingsInfo | null>

// 已有绝对路径（拖拽、将来扩展）
appearance:importBackground(sourcePath: string): Promise<AppearanceSettingsInfo>
```

`pickBackground` 内部：对话框取消返回 `null`；选中则调 `importBackgroundAsset`。

#### 4.7.4 拖拽上传（Renderer）

Electron 拖拽文件时，`dataTransfer.files[0].path` 在 preload 暴露下可拿到绝对路径（与 workspace 附件一致，复用 `webUtils.getPathForFile` 模式）。

```typescript
// AppearancePage 预览区
onDrop={(e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file?.type.startsWith('image/')) return showToast('请选择图片文件');
  const path = window.shorekeeper.utils.getPathForFile(file);
  void window.shorekeeper.appearance.importBackground(path);
}}
```

拖拽与「从本机选择」共用同一 `importBackgroundAsset` 逻辑。

#### 4.7.5 渲染与布局

自定义图与内置 `keeper-bg.png` 使用**同一套 CSS**：

```css
.keeper-scene {
  background-color: var(--sk-navy-deep);
  background-image: var(--sk-bg-image);
  background-repeat: no-repeat;
  background-position: center center;
  background-size: cover;
}
```

| 窗口 | 行为 |
|------|------|
| **chat** | 全幅 cover + 左侧 `keeper-veil` 渐变 |
| **status** | 同图，`keeper-scene-status` 略放大/偏右，居中展示 |
| **schedule** | 若共用 AppBackground，同上 |
| **dock** | **不用**全幅背景（保持透明），避免遮挡桌面 |

**CSP / 加载：** 生产包需在 `webPreferences` 允许加载 `file://` 本地资源（当前 Electron 本地加载已支持静态 public；自定义路径通过 `appearance:resolveUrl` 或 `get()` 返回的 `backgroundUrl` 写入 CSS 变量即可）。开发模式 `pnpm dev` 同样走 `file://` 绝对路径，不经过 Vite 代理。

#### 4.7.6 遮罩强度（可选，建议 P3 一并做）

用户壁纸可能过亮/过杂，增加可调遮罩：

| Key | 说明 |
|-----|------|
| `ui.theme.veil_opacity` | 0.0–1.0，默认用 preset 值；有自定义背景时默认 **0.85** |

UI 滑块实时更新 `--sk-veil-opacity`，乘在现有 gradient 的 alpha 上。恢复预设背景时重置为 preset 默认。

#### 4.7.7 恢复与清理

| 操作 | 行为 |
|------|------|
| **恢复预设背景** | `assets.background = null`；删除 `appearance/bg-*`；`--sk-bg-image` 回 preset 内置图 |
| **切换主题预设** | **保留**用户自定义背景（仅色板/veil 变）；除非用户勾选「同时恢复默认背景」 |
| **应用卸载** | 不自动删 `D:\SQLlite\appearance\`（用户数据）；安装包覆盖升级保留 |

#### 4.7.8 错误与边界

| 场景 | 处理 |
|------|------|
| 文件 > 8MB | Toast「图片不能超过 8MB」 |
| 非图片 / 扩展名不符 | 拒绝并提示支持格式 |
| 复制失败（磁盘满） | 保留旧背景，报错 |
| 图片极大尺寸（如 8K） | 允许使用；可选 Phase 2 用 `@napi-rs/canvas` 或 `sharp` 生成 max 2560px 缩略图以省内存（**非必须**） |
| 损坏文件 | `import` 时 try decode；失败则拒绝 |

#### 4.7.9 测试补充

| 用例 | 期望 |
|------|------|
| pick jpg | 出现在 appearance/，DB 有相对路径 |
| 拖拽 png | 与 pick 行为一致 |
| 重启应用 | 仍显示用户图 |
| clear background | 文件删除，回内置 keeper-bg |
| 路径穿越 `../` | resolve 拒绝 |
| chat + status 同时打开 | 两窗背景一致 |

### 4.8 多窗口同步

```
Main: setPreset / pickBackground
  → save app_settings
  → broadcastToAllWindows('appearance:changed', info)

Each renderer:
  onChanged → applyTheme(info)
```

`chat` / `status` / `dock` 均注册 listener（`initAppearance.ts`）；背景变更时 **chat / status / schedule** 刷新，`dock` 仅同步主题色与头像。

### 4.9 测试要点

| 用例 | 期望 |
|------|------|
| 切换 midnight | `--sk-*` 变化，preset_id 持久化 |
| pick 背景 | 文件复制到 appearance/，重启后仍生效 |
| clearAsset | 回退 preset 默认图 |
| 多窗口 | chat 改主题，status 同步 |
| 无效 preset id | 回退 shorekeeper |

---

## 5. 设置导航结构调整

```
能力
  插件 · 技能 · MCP
人格与记忆
  人设          ← 新增 PersonaPage
  用户信息
  记忆
  Worldbook
个性化            ← 新分组
  外观          ← 新增 AppearancePage
数据与任务
  文档 · 定时任务
系统
  API 设置 · 免责声明
```

`SettingsTab` 类型增加 `'persona' | 'appearance'`。

---

## 6. 架构总览

```
┌──────────────── Renderer ────────────────────────────────────┐
│  PersonaPage ──IPC──► persona:set ──► app_settings           │
│  AppearancePage ──IPC──► appearance:setPreset / pick*        │
│  applyTheme() ◄── appearance:changed (broadcast)             │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌──────────────── Main ──────▼─────────────────────────────────┐
│  persona.ts / appearance.ts                                    │
│  invalidateStableContext()  (persona 变更)                     │
│  copy asset → getAppearanceDir()                               │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌──────────────── Data ──────▼─────────────────────────────────┐
│  shorekeeper.db (app_settings)                                 │
│  D:\SQLlite\appearance\  (用户图片)                            │
└────────────────────────────────────────────────────────────────┘

Agent 对话（与人设相关）:
  buildSystemPromptParts → loadPersonaPrompt() ← app_settings
```

---

## 7. 实施阶段

| Phase | 范围 | 工期 | 验收 |
|-------|------|------|------|
| **P1** | 人设：修 `ensurePersonaUpToDate` · `persona.ts` · IPC · PersonaPage · 测试 | 1 天 | UI 可编辑保存；custom 不被覆盖；下条消息生效 |
| **P2** | 外观：CSS 变量 · 3 预设 · `appearance.ts` · IPC · applyTheme · AppearancePage | 1.5 天 | 预设切换即时生效；重启保持 |
| **P3** | 外观：自定义背景/头像 pick · 多窗口广播 · tray 头像 · Agent/UserAvatar 动态 src | 1 天 | 换图全窗同步 |
| **P4** | 文档 · README · 更新 UI-THEME.md · DESIGN.md 交叉引用 | 0.5 天 | 文档与行为一致 |

**可选 Phase 5：** 人设模板导入导出（JSON）、对话风格 `style` 下拉接入 orchestrator。

---

## 8. 文件结构预览（变更后）

```
src/
├── config/
│   ├── persona.ts                 # P1
│   ├── appearance.ts              # P2
│   ├── paths.ts                   # + getAppearanceDir()
│   └── themes/
│       ├── index.ts
│       ├── shorekeeper.json
│       ├── midnight.json
│       └── dawn.json
├── db/
│   └── seed.ts                      # P1 修复 ensurePersonaUpToDate
├── agent/
│   └── stable-context.ts            # P1 invalidate 已由 IPC 调用
├── shared/
│   └── types.ts                     # Persona* / Appearance* 类型
└── renderer/
    ├── settings/
    │   ├── PersonaPage.tsx          # P1
    │   ├── AppearancePage.tsx       # P2
    │   ├── SettingsSidebar.tsx      # 导航
    │   └── SettingsDrawer.tsx
    ├── theme/
    │   ├── apply-theme.ts           # P2
    │   └── use-appearance.ts        # P2
    ├── components/
    │   ├── AppBackground.tsx        # P2/P3
    │   ├── AgentAvatar.tsx          # P3
    │   └── UserAvatar.tsx           # P3
    └── styles/
        └── globals.css              # P2 CSS variables

electron/
├── ipc/
│   ├── persona.ts                   # P1
│   └── appearance.ts                # P2/P3
├── main.ts                          # register IPC
├── preload.ts
└── windows/
    └── broadcast.ts                 # P3 appearance:changed

docs/
├── UI-THEME.md                      # P4 更新为「预设 + 自定义」
└── superpowers/specs/
    └── 2026-07-01-persona-appearance-design.md  # 本文档
```

---

## 9. 安全与边界

| 项 | 处理 |
|----|------|
| Prompt 注入 | 人设仅进 system role，不执行代码；长度上限 16k |
| 图片路径 | 仅允许 `appearance/` 目录内相对路径，禁止 `..` 穿越 |
| file:// 加载 | 使用 Electron 标准本地资源协议；不暴露任意路径读取 |
| 恢复默认 | 人设 reset 需确认；外观 clear 只删用户上传文件 |
| 备份 | 用户画像 + 人设 + 主题均在 `shorekeeper.db` + `appearance/`，与现有备份策略一致 |

---

## 10. 开放问题（评审时可定）

| # | 问题 | 建议默认 |
|---|------|----------|
| Q1 | 人设是否与 Worldbook 联动「一键导出角色包」？ | Phase 5 再做 |
| Q2 | 自定义背景是否支持视频/GIF？ | 否，仅静态 png/jpg/webp；GIF 当静态首帧或不支持 |
| Q2b | 是否支持粘贴剪贴板图片？ | Phase 2 可选；P3 先做文件选择与拖拽 |
| Q3 | `display_name` 是否同步到状态面板标题？ | 是，P1 一并改 Status 页展示 |
| Q4 | 预设不足 3 套是否可接受？ | 先 3 套，后续加 JSON 即可扩展 |
| Q5 | Dock 窗是否也要背景图？ | Dock 保持透明极简，仅头像跟主题色 |

---

## 11. 验收清单（整体）

- [ ] 设置 → 人设：编辑 prompt 保存后，新开对话回复风格符合新人设
- [ ] 重启应用后 custom 人设仍在
- [ ] 恢复默认后 prompt 与内置 seed 一致
- [ ] Worldbook 页 Intro 与人设页 Intro 不混淆
- [ ] 设置 → 外观：切换 midnight/dawn 后聊天窗配色变化
- [ ] 从本机选择 / 拖拽上传背景后 chat、status 立即显示新图
- [ ] 更换头像后 chat、status、dock 一致
- [ ] 恢复预设背景后 appearance/ 下旧 bg 文件已删除
- [ ] 重启后主题与自定义图片保持
- [ ] Vitest：`ensurePersonaUpToDate` 规则 + `applyTheme` 合并逻辑有单测

---

## 12. 参考代码（现状）

| 模块 | 路径 |
|------|------|
| 人设加载 | `src/agent/stable-context.ts` → `loadPersonaPrompt()` |
| 人设 seed | `src/db/seeds/persona-shorekeeper.ts` |
| 启动覆盖 | `src/db/seed.ts` → `ensurePersonaUpToDate()` |
| Worldbook 匹配 | `src/memory/worldbook.ts` → `matchWorldbook()` |
| 背景组件 | `src/renderer/components/AppBackground.tsx` |
| 现有主题文档 | `docs/UI-THEME.md` |

---

**评审通过后**，使用 `writing-plans` 技能生成 `docs/superpowers/plans/2026-07-01-persona-appearance.md` 实施计划。
