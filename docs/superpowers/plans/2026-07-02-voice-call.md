# 语音通话（微信式实时对话）实施计划

> **版本：** 0.3.0-draft
> **日期：** 2026-07-02（C4 落地同步：2026-07-02）
> **状态：** C1–C4 已落地 · C5 待实施
> **设计依据：** [DESIGN.md](../../DESIGN.md) §5.9 TTS、§3.3 多窗模型、§6 AG-UI 事件
> **关联计划：** 承接 [语音能力计划](./2026-07-01-voice.md) V3（STT）+ V5（全双工）；本计划将两者收敛为「通话」这一完整体验
> **前置：** 已落地 Voice V1（CosyVoice TTS 按需/自动朗读）；**假设已配置一个可用的复刻 `voice_id`**

**Goal：** 为 The Shorekeeper 增加一个「语音通话」入口：用户点击后进入独立通话窗，像微信语音通话一样与守岸人连续对话——用户说话被实时识别，Agent 回复以**现有自定义复刻音色**低延迟流式播放。分两档交付：**MVP 半双工（对讲机式）** 与 **完整版全双工（连续、可打断）**。**当前默认已是全双工 + 可打断**；半双工可在设置中切回。

**关键约束：坚持使用自定义复刻音色。** 因此**不采用**百炼 Qwen-Omni 端到端「语音进语音出」方案（其音色固定、无法用复刻声线），而是走 **STT → Agent → CosyVoice 复刻音色 TTS** 的三段式管线，自行掌控轮次与延迟。这是「音色个性化」换「端到端最低延迟」的明确取舍。

**Architecture：** 遵循「主进程持有智能、渲染进程只展示」。STT/TTS API 调用与 API Key 均在 Main Process；渲染进程负责麦克风采集、VAD、Web Audio 播放、通话 UI。一次通话由主进程 `CallSession` 状态机编排（idle / listening / thinking / speaking），生命周期事件经现有 `broadcastAgentEvent` 广播。

**Tech Stack：** 百炼 Paraformer 实时语音识别（WebSocket）· 百炼 CosyVoice 流式合成（WebSocket，复刻 voice_id）· `@ricky0123/vad-web`（浏览器端 VAD）· Web Audio API · MediaRecorder / AudioWorklet · 现有 Agent orchestrator 与 AG-UI 事件流

---

## 背景与决策记录

| 日期 | 决策 |
|------|------|
| 2026-07-02 | 语音通话独立成计划；**否决 Qwen-Omni 端到端方案**，因其无法使用 CosyVoice 复刻音色；坚持三段式管线保住自定义声线 |
| 2026-07-02 | 分两档交付：先 MVP 半双工（复用现有 REST TTS，风险低），再全双工（换 WebSocket 流式 + VAD + 打断） |
| 2026-07-02 | 通话独立窗 `?panel=call`，仿现有多窗模型（[DESIGN.md](../../DESIGN.md) §3.3）；不阻塞聊天窗 |
| 2026-07-02 | **默认触发方式定为 `push_to_talk`（按住说话）**：最稳、无回声/误触发，MVP（C2）即用；免按键 `vad_auto` 与打断放到 C4 全双工 |
| 2026-07-02 | **（修订）默认改为 `vad_auto` + `callAllowBargeIn: true`**：C4 落地后以全双工实时对话为主体验；半双工仍可在设置/通话窗切回 |
| 2026-07-02 | C1–C3 实施时跳过 C2 原计划 REST TTS 主路径，通话端到端走 WebSocket 流式 STT/TTS + MSE 播放 |
| 2026-07-02 | VAD 封装置于 **`src/renderer/voice/vad.ts`**（非主进程）；静态资源经 `scripts/copy-vad-assets.mjs` → `public/vad/` |
| 2026-07-02 | **流式 STT/TTS 官方协议由用户提供文档核对**：Step 0 的 endpoint / 消息格式在拿到官方文档前保持占位，不凭记忆写入，避免过时错误 |

**非目标：**

- 多人通话 / 群语音
- 视频通话、虚拟形象口型（口型联动见 voice 计划 V4，M8 桌宠后再对接）
- 离线本地 STT/TTS
- 通话录音归档为音频文件（仅文本转写可选入会话/记忆）

---

## 能力分期总览

| 阶段 | 名称 | 预计工期 | 交付物 | 依赖 |
|------|------|----------|--------|------|
| **C1** | STT 引擎 + 录音 | 2–3 天 | 百炼识别、录音 hook、`voice:transcribe` | Voice V1 配置体系 |
| **C2** | MVP 半双工通话窗 | 2–3 天 | `?panel=call` 窗、按住/静音触发、复刻音色流式回复、挂断 | C1 |
| **C3** | 流式化（低延迟） | 2–3 天 | CosyVoice/Paraformer WebSocket 流式；边生成边说 | C2 |
| **C4** | 全双工 + 打断 | 3–4 天 | VAD 连续聆听、barge-in 打断、连续循环 | C3 |
| **C5** | 打磨与集成 | 1–2 天 | 用量显示、记忆/好感度接入、错误恢复 | C4 |

**当前进度：** C1 ✅ · C2 ✅ · C3 ✅ · C4 ✅ · C5 ⏳

**推荐实施顺序：** C1 → C2（此时已有可用的半双工通话）→ C3 → C4 → C5。C2 结束即可作为里程碑独立体验。**现默认已是 C4 全双工形态**；C5 为打磨项。

---

## 系统架构

### 通话数据流（完整版 C4 目标形态）

```
[Renderer 通话窗]
  麦克风采集(getUserMedia)
    → VAD 检测语音起止(@ricky0123/vad-web)
    → 用户开口 → 若正在播放 Agent 语音 → 立即 barge-in：
         voice:call:interrupt → 主进程 abort TTS + 停 STT 上行
    → 语音帧上行 → IPC voice:stt:push(chunk)
[Main CallSession 状态机]
    → 流式 STT(Paraformer WS) → partial / final 文本
    → final 触发 → 送入现有 orchestrator.run(sessionId, text)
    → 消费 text_delta 流 → 分句(text-for-speech.splitDialogueIntoChunks)
    → 每句 → 流式 CosyVoice(WS, 复刻 voice_id) → 音频块
    → broadcast agent:event { call_audio_chunk } × N
[Renderer]
    → Web Audio 队列连续播放 → 完成 → 回到 listening
    → 全程状态灯：listening / thinking / speaking
```

### 实际落地数据流（C3+C4，当前主路径）

```
[Renderer 通话窗 CallStage]
  VAD(@ricky0123/vad-web) 检测起止 → onSpeechStart/onSpeechEnd
  onSpeechStart → startPcmRecording + voice:stt:startCallStream
  PCM 帧 → voice:stt:pushChunk
  onSpeechEnd → voice:stt:finishCallStream → voice:call:userText
  播放中用户开口 + callAllowBargeIn → voice:call:interrupt + stop 播放队列
[Main CallSession]
  text_delta → DeltaSentenceBuffer → CosyVoice WS → call_audio_chunk
  interrupt() → abort run + abort TTS → listening
[Renderer]
  useCallStreamPlayback(MSE/WebAudio) → call_speech_end → speakingDone
```

半双工（`push_to_talk`）仍可用：VAD 仅在 barge-in 开启时于 thinking/speaking 运行；聆听阶段靠按住说话。

### MVP 半双工数据流（C2 原计划，仍可切换回）

```
用户按住「说话」或 VAD 检测到一段完整语音
  → 停止 → voice:transcribe(ArrayBuffer) → 文本
  → orchestrator.run(sessionId, 文本)  // 复用现有 Agent 循环
  → run_finished 后取最终文本
  → 现有 voice:synthesize（复刻音色）→ 分段音频
  → useVoicePlayback 播放 → 播完 → 回到「可说话」
  ⚠️ 播放期间不听麦克风（无打断），播完才继续
```

半双工**完全复用现有 [bailian-tts.ts](../../../src/voice/bailian-tts.ts) + [useVoicePlayback.ts](../../../src/renderer/hooks/useVoicePlayback.ts)**，只新增 STT 与通话窗，风险最低。

### 自定义音色如何保住（贯穿全程）

通话回复的合成始终走现有路径：`getVoiceSettings().ttsVoiceId`（复刻 voice_id）+ `ttsModel`（须与复刻 `target_model` 一致）。C3 流式化时新增 WebSocket 引擎，但 `model` / `voice` 参数与现有 REST 引擎相同，音色不变。**通话与"点 🔊 朗读"用的是同一个复刻声线。**

### 分层与文件布局

```
src/voice/
  types.ts                 # SttResult、CallState、callMode/callSilenceMs 等
  bailian-stt.ts           # Paraformer WS：transcribe + createSttStreamSession
  stt-engine.ts            # SttEngine 接口
  bailian-tts-stream.ts    # CosyVoice WebSocket 流式合成
  delta-sentence-buffer.ts # text_delta 分句缓冲（C3）
  call-session.ts          # 状态机 + interrupt() + 流式 TTS
  text-for-speech.ts       # 复用现有分句
electron/ipc/
  voice.ts                 # voice:transcribe、voice:call:*、voice:stt:*
electron/windows/
  call.ts                  # 通话窗 create/show
src/renderer/
  voice/vad.ts             # MicVAD 封装（C4，浏览器端）
  voice/record-pcm.ts      # 16k PCM 采集
  voice/call-stream-playback.ts  # MSE 流式播放
  hooks/useVoiceInput.ts   # 录音 + 通话流式 STT
  hooks/useCallVad.ts      # VAD 生命周期（C4）
  hooks/useCallStreamPlayback.ts
  call/CallStage.tsx       # 通话 UI（?panel=call 于 main.tsx 挂载）
scripts/
  copy-vad-assets.mjs      # 同步 VAD/ONNX 资源 → public/vad/
public/vad/                # 生成目录（.gitignore），dev/build 前自动复制
```

### AG-UI / IPC 事件扩展

现有 `agent:event` 广播新增通话专用事件（`src/agent/types.ts` + `src/shared/types.ts` re-export）：

```typescript
| { type: 'call_state'; callId: string; state: 'idle' | 'listening' | 'thinking' | 'speaking' }
| { type: 'call_transcript'; callId: string; role: 'user' | 'assistant'; text: string; final: boolean }
| { type: 'call_audio_chunk'; callId: string; audio: ArrayBuffer; seq: number; mime: string }
| { type: 'call_speech_end'; callId: string }
| { type: 'call_error'; callId: string; message: string }
```

IPC 契约（渐进补齐）：

| Channel | 方向 | 参数 | 返回 | 阶段 |
|---------|------|------|------|------|
| `voice:transcribe` | invoke | `{ audio: ArrayBuffer; mime: string; lang?: string }` | `{ ok, text } \| { ok:false, error }` | C1 |
| `voice:call:start` | invoke | `{ sessionId }` | `{ ok, callId }` | C2 |
| `voice:call:userText` | invoke | `{ callId; text }` | `{ ok }`（触发 Agent 轮次） | C2 |
| `voice:call:interrupt` | invoke | `{ callId }` | `{ ok }`（打断 TTS + Agent run） | C4 |
| `voice:call:speakingDone` | invoke | `{ callId }` | `{ ok }`（播放完成→listening） | C3 |
| `voice:call:end` | invoke | `{ callId }` | `{ ok }` | C2 |
| `voice:stt:startCallStream` | invoke | `{ callId }` | `{ ok }` | C3 |
| `voice:stt:pushChunk` | invoke | `{ callId; chunk }` | `{ ok }` | C3 |
| `voice:stt:finishCallStream` | invoke | `{ callId }` | `{ ok, text }` | C3 |
| `voice:stt:abortCallStream` | invoke | `{ callId }` | `{ ok }` | C3 |

### 配置模型（扩展现有 `voice.settings`）

在现有 [VoiceSettings](../../../src/voice/types.ts) 上新增通话相关字段（保持向后兼容，默认值不影响现有朗读）：

```typescript
interface VoiceSettings {
  // …现有字段不变…
  /** 通话触发方式 */
  callMode: 'push_to_talk' | 'vad_auto';   // 默认 vad_auto（全双工）
  /** VAD 静音判定阈值（ms），说话停顿多久算一句结束 */
  callSilenceMs: number;                    // 默认 800
  /** 全双工：允许说话打断 Agent 播放 */
  callAllowBargeIn: boolean;                // 默认 true
  /** 通话轮次是否写入会话/记忆 */
  callPersistTranscript: boolean;           // 默认 true
}
```

`.env` 可选覆盖（沿用 voice 计划）：

```env
VOICE_STT_ENDPOINT=          # Paraformer 识别 endpoint
VOICE_STT_MODEL=paraformer-realtime-v2
```

---

## 前置准备

> **协议已确认（2026-07-02，据百炼官方文档截图）：** STT/TTS 的 WebSocket 指令与服务端事件已锁定，见文末[附录 A：已确认的百炼 WebSocket 协议](#附录-a已确认的百炼-websocket-协议)。以下 Step 0 仅剩账号侧取值。

- [x] **Step 0.1** ~~Paraformer endpoint / 协议~~ 已确认（附录 A）
- [x] **Step 0.2** ~~CosyVoice 流式协议 / abort~~ 已确认（`finish-task` 收尾；断开连接即中止）
- [x] **Step 0.3** ~~复刻 voice_id 在流式下有效~~ 已确认：`voice` 参数直接填复刻 voice_id，用法同预设
- [x] **Step 0.4** ~~评估 `@ricky0123/vad-web` 在 Electron(Chromium) 下的可用性与包体~~ 已在 Electron 34 + Windows 验证；VAD/ONNX 资源经 `public/vad/` 提供（约 80MB，含多 ORT WASM 变体；后续可瘦身）
- [x] **Step 0.5** ~~确认 Electron/Windows 麦克风权限行为~~ 已有 PermissionDialog + record-pcm 中文错误映射
- [ ] **Step 0.6** `.env.example` 增加 `VOICE_STT_*` 占位
- [x] **Step 0.7** ~~记录 Workspace ID~~ 已定：**使用旧域名 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`**（无需 Workspace 子域）；带 Workspace 的形式作为可选 `.env` 覆盖
- [x] **Step 0.8** ~~开通并计费~~ 已确认账号已开通 Paraformer 识别与 CosyVoice 流式合成

---

# C1：STT 引擎 + 录音

**交付物：** 主进程百炼识别引擎；IPC `voice:transcribe`；渲染进程录音 hook。

> **实现偏差（已确认）：** 原计划写"REST 一次性识别"，但百炼 Paraformer 无本地音频的 REST 接口（HTTP 录音文件识别需公网 URL）。既然账号已开通 Paraformer 实时且 WS 协议已确认（附录 A），C1 直接建在 **WebSocket** 上：一次性录音 → 开 WS → 送 PCM 帧 → `finish-task` → 收 `task-finished` 汇总文本。用对接口、不做无用功，且 C3 流式可直接复用。代价：新增轻量依赖 `ws`（纯 JS，已加打包白名单）+ 录音采 16k/16bit/mono PCM（AudioWorklet）。

**验收：** 录一段 3–5 秒中文，5 秒内返回准确文本；无 Key / 识别失败有中文提示；不崩溃。

---

### Task C1-1：STT 引擎（百炼）

**Files:**
- Create: `src/voice/stt-engine.ts`
- Create: `src/voice/bailian-stt.ts`
- Modify: `src/voice/types.ts`（`SttResult`、STT 相关字段）

- [x] **Step 1** `SttEngine.transcribe(pcm: ArrayBuffer, options: SttOptions): Promise<SttResult>`；`SttResult = { text: string }`（一次性识别，无需 mime——固定 PCM）
- [x] **Step 2** `BailianSttEngine` — **WebSocket** Paraformer；复用 `resolveVoiceApiKey()`；endpoint 走 `resolveSttWsEndpoint()`（`VOICE_STT_ENDPOINT` 或默认旧域名）；超时 30s；`socketFactory` 可注入便于测试；无 Key / task-failed / 鉴权错误映射为可读中文错误
- [x] **Step 3** 音频固定 16k/16bit/mono PCM（`SttOptions.sampleRate`）；空音频保护
- [x] **Step 4** 单测：`src/voice/__tests__/bailian-stt.test.ts`，注入假 socket 验证指令与事件解析（7 用例：happy path / 多句拼接 / task-failed / 鉴权错误 / 提前 close / 无 Key / 空音频）
- [ ] **Step 5** Commit `feat(voice): bailian stt engine`（待用户确认后一并提交）

---

### Task C1-2：IPC + 录音 Hook

**Files:**
- Modify: `electron/ipc/voice.ts` — `voice:transcribe`
- Modify: `electron/preload.ts` — 暴露 `voice.transcribe`
- Modify: `src/shared/types.ts` — payload/result 类型
- Create: `src/renderer/hooks/useVoiceInput.ts` + `src/renderer/voice/record-pcm.ts`

- [x] **Step 1** `voice:transcribe` handler：读 `sttEnabled`，空音频保护，`sttLanguage`→`language_hints`，调 `getBailianSttEngine()`
- [x] **Step 2** `record-pcm.ts` — `getUserMedia` + 16kHz `AudioContext` + inline AudioWorklet 采 Float32→Int16 PCM；`useVoiceInput` push-to-talk（start / stopAndTranscribe / cancel），generation-guard + 卸载清理，含 level 电平
- [x] **Step 3** 麦克风被拒 / 无设备 / 被占用 → 友好中文错误态
- [ ] **Step 4** 手动验收：DevTools 录音 → `voice.transcribe`（需 `pnpm dev` 实机，待用户执行）
- [ ] **Step 5** Commit `feat(voice): stt ipc and recording hook`（待用户确认后一并提交）

---

### C1 验收清单

- [ ] 中文短句识别可用（主观测 10 句）— 需实机 `pnpm dev`
- [x] 无 Key / 拒绝麦克风有明确提示（引擎与 hook 均已映射中文错误）
- [x] `pnpm typecheck` 通过；`pnpm test src/voice` 41 用例全过（含 interrupt 单测）

---

# C2：MVP 半双工通话窗

**交付物：** 独立通话窗 `?panel=call`；按住说话或 VAD 单句触发；识别→Agent→**复刻音色**回复播放；挂断。**不含打断。**

**验收：** 打开通话窗，说一句话，守岸人用复刻声线回复并播放；播完可再说；点挂断结束并可留转写。全程复用现有 TTS。

---

### Task C2-1：通话窗（进程 + 入口）

**Files:**
- Create: `electron/windows/call.ts`（仿 [chat 窗管理]，透明/圆角按需）
- Modify: `electron/windows/`（WindowManager 注册 call）
- Modify: `electron/ipc/window.ts` / `dock` — 打开通话窗入口
- Create: `src/renderer/call/main-call.tsx`（`?panel=call` 挂载）
- Modify: 渲染入口路由（现有 `?panel=` 分发处，见 [DESIGN.md](../../DESIGN.md) §3.3）

- [x] **Step 1** 新增 call 窗；WindowManager 注册；bounds 持久化
- [x] **Step 2** `?panel=call` 加载 `CallStage`（`src/renderer/main.tsx`）
- [x] **Step 3** 聊天窗顶栏 / 状态面板「语音通话」入口
- [ ] **Step 4** Commit `feat(call): call window shell and routing`

---

### Task C2-2：CallSession 状态机（主进程）

**Files:**
- Create: `src/voice/call-session.ts`
- Modify: `electron/ipc/voice.ts` — `voice:call:start/userText/end`
- Modify: `src/agent/types.ts` + `src/shared/types.ts` — `call_state` / `call_transcript` 事件

- [x] **Step 1** `CallSession.start` / `submitUserText` / `speakingDone` / `end`
- [x] **Step 2** 实际主路径：`text_delta` → 流式 CosyVoice（非 REST `voice:synthesize`）；WS 失败时 REST fallback
- [x] **Step 3** 广播 `call_state` / `call_transcript` / `call_audio_chunk` / `call_speech_end`
- [x] **Step 4** `end()` abort run；C4 新增 `interrupt()` 不打断 session 生命周期
- [x] **Step 5** 单测：`call-session.test.ts`（含 interrupt 3 用例）
- [ ] **Step 6** Commit `feat(call): call session state machine`

---

### Task C2-3：通话 UI

**Files:**
- Create: `src/renderer/call/CallStage.tsx`
- 复用: `src/renderer/hooks/useVoiceInput.ts`、`useVoicePlayback.ts`

- [x] **Step 1** 头像 + 状态灯 + 挂断；全双工/半双工 UI 分支
- [x] **Step 2** 流式 STT + `voice:call:userText`；订阅 `call_state` / `call_error`
- [x] **Step 3** `useCallStreamPlayback` 流式播放（非 `useVoicePlayback`）
- [ ] **Step 4** 顶部滚动转写 UI（事件已广播，UI 未做 → C5）
- [ ] **Step 5** Commit `feat(call): half-duplex call ui`

---

### C2 验收清单

- [ ] 打开通话窗可完成完整回合（需实机验收）
- [x] 回复走 CosyVoice 复刻 voice_id
- [x] 半双工模式下播放期间不误采（`canSpeak` 门控）
- [x] 挂断 abort 进行中 run
- [ ] `callPersistTranscript` 写入会话历史（配置存在，逻辑未接 → C5）

---

# C3：流式化（降低延迟）

**交付物：** CosyVoice / Paraformer WebSocket 流式；Agent `text_delta` 边生成边分句合成、边收边播，显著缩短「说完到听到」的等待。

**验收：** 相比 C2，Agent 首个音字明显更快出现；长回复不再整段等待。

---

### Task C3-1：CosyVoice 流式合成

**Files:**
- Create: `src/voice/bailian-tts-stream.ts`
- Modify: `src/voice/tts-engine.ts` — 增加 `synthesizeStream?()` 可选接口

- [x] **Step 1** `bailian-tts-stream.ts` WebSocket CosyVoice；复刻 model/voice
- [x] **Step 2** `pushText` / `finish` / `abort` + 二进制音频块
- [x] **Step 3** `DeltaSentenceBuffer` + `text-for-speech` 分句
- [x] **Step 4** 单测 `bailian-tts-stream.test.ts`
- [ ] **Step 5** Commit `feat(voice): cosyvoice streaming tts`

---

### Task C3-2：Agent delta → 流式合成 → 流式播放

**Files:**
- Modify: `src/voice/call-session.ts` — 消费 orchestrator `text_delta`，喂流式 TTS
- Modify: `electron/ipc/voice.ts` — 广播 `call_audio_chunk`
- Modify: `src/renderer/hooks/useVoicePlayback.ts` — 增加流式入队播放接口

- [x] **Step 1** CallSession 消费 `text_delta` → `pushText`
- [x] **Step 2** `call_audio_chunk` 广播（≤512KB）
- [x] **Step 3** `call-stream-playback.ts` + `useCallStreamPlayback` seq 保序
- [ ] **Step 4** Commit `feat(call): streaming pipeline delta-to-audio`

---

### Task C3-3：流式 STT（可选提前）

**Files:**
- Modify: `src/voice/bailian-stt.ts` — 增加 WebSocket 实时识别
- Modify: `electron/ipc/voice.ts` — `voice:stt:pushChunk`、partial 广播

- [x] **Step 1** `createSttStreamSession` + `voice:stt:*` IPC
- [x] **Step 2** partial → `call_transcript`（final: false）；UI 未展示 → C5
- [ ] **Step 3** Commit `feat(voice): streaming stt`

---

### C3 验收清单

- [ ] 首音字延迟较 REST 明显下降（需主观实机）
- [x] 长回复边说边播（流式管线已通）
- [x] WS TTS 失败 early → REST fallback；**无 WS 自动重连**（→ C5）

---

# C4：全双工 + 打断

**交付物：** VAD 连续聆听；用户开口即打断 Agent 播放（barge-in）；无需按键的连续对话循环。

**验收：** 开启全双工后，Agent 说话中用户插话能立即停下并转听；连续多轮无需手动操作。

---

### Task C4-1：VAD 与连续聆听

**Files:**
- Create: `src/renderer/voice/vad.ts`（浏览器端，非 `src/voice/`）
- Create: `src/renderer/hooks/useCallVad.ts`
- Modify: `src/renderer/call/CallStage.tsx`
- Create: `scripts/copy-vad-assets.mjs` → `public/vad/`

- [x] **Step 1** 集成 `@ricky0123/vad-web`：`onSpeechStart` / `onSpeechEnd`；`ort.env.wasm.numThreads = 1`（Electron）
- [x] **Step 2** `redemptionMs` ← `callSilenceMs`；句末 `stopAndTranscribe` → `userText`
- [x] **Step 3** `callMode: vad_auto` 连续聆听；默认已启用
- [ ] **Step 4** Commit `feat(call): vad continuous listening`

---

### Task C4-2：Barge-in 打断

**Files:**
- Modify: `src/voice/call-session.ts` — `interrupt()`
- Modify: `electron/ipc/voice.ts` — `voice:call:interrupt`
- Modify: `src/renderer/call/CallStage.tsx` — 检测到用户开口即触发

- [x] **Step 1** VAD `onSpeechStart` → `voice:call:interrupt`（thinking/speaking + barge-in）
- [x] **Step 2** `interrupt()` abort run + TTS；IPC `abortCallSttStream`
- [x] **Step 3** `useCallStreamPlayback.stop()` + reset 队列
- [x] **Step 4** 状态回 `listening`；同段 speech 内重启 STT
- [x] **Step 5** AEC + 播放阶段高 VAD 阈值 + 300ms debounce
- [ ] **Step 6** Commit `feat(call): barge-in interrupt`

---

### C4 验收清单

- [ ] 插话 ~300ms 内停播（需实机）
- [x] 打断后不继续旧 TTS（abort + 清队列）
- [ ] 无明显回声自触发（需实机：耳机 + 外放）
- [x] 设置页 + 通话窗顶栏可切换半双工/全双工

---

# C5：打磨与集成

**Files:**
- Modify: `src/renderer/call/CallStage.tsx`、`src/voice/call-session.ts`

- [ ] **Step 1** 通话窗顶部实时 Token / 用量显示 + 明显「挂断」硬开关（成本可见）
- [ ] **Step 2** 通话转写按 `callPersistTranscript` 接入现有记忆提取 / 好感度加分（复用 orchestrator 副作用，自然继承）
- [ ] **Step 3** 错误恢复：STT/TTS 失败 → 通话窗内联提示 + 可重试，不中断整通
- [ ] **Step 4** 网络抖动：WS 断线重连；连续失败降级半双工
- [ ] **Step 5** Commit `feat(call): usage display, persistence, error recovery`

---

## 测试策略

| 层级 | 工具 | 覆盖 |
|------|------|------|
| 单元 | Vitest | `bailian-stt`、`call-session` 状态流转、流式分句、abort |
| 集成 | Vitest | STT→CallSession→TTS mock 全链、打断路径 |
| 手动 | 每 Phase 验收清单 | 网络、麦克风权限、回声、多轮、挂断、成本 |

```bash
pnpm test src/voice    # 当前 41 用例
pnpm typecheck
pnpm dev               # 会先执行 copy-vad-assets.mjs
```

---

## 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 坚持复刻音色 → 无法用 Omni 端到端 | 延迟高于微信原生 | 三段式 + 全程 WebSocket 流式；分句边说边播压低感知延迟 |
| 回声：Agent 声音被自己麦克风采集 | 自触发打断 / 循环 | `echoCancellation:true`；播放期间提高 VAD 阈值；必要时半双工兜底 |
| IPC 传大 ArrayBuffer | 卡顿 | 单音频块 ≤512KB；或 temp 文件 + `sk-asset://`（见 voice 计划风险表） |
| WebSocket 国内网络抖动 | 通话中断 | 重连 + 降级 REST/半双工；参考 edge-tts 被移除教训 |
| 连续通话计费快 | 成本失控 | 通话窗实时用量 + 硬挂断（C5）；默认已全双工，STT 调用更频 |
| VAD/ONNX 安装包体积 | 安装包 +~80MB | `public/vad/` 多 ORT 变体；后续 copy 脚本瘦身 |
| pnpm 构建脚本审批 | `pnpm dev` 失败 | `pnpm-workspace.yaml` `allowBuilds.protobufjs: false` |
| STT 识别错 → Agent 答非所问 | 体验差 | partial 回显让用户可见；错误可挂断重说；`sttLanguage` 可锁中文 |
| VAD 误判（背景噪切句） | 频繁打断/断句 | `callSilenceMs` 可调；`@ricky0123/vad-web` 灵敏度参数 |
| model / voice 不匹配 | 合成失败 | 沿用现有校验：复刻 `target_model === ttsModel` |
| 复刻音色失效（1 年未用被删） | 通话无声 | 启动对账 `listEnrolledVoices`（voice 计划 V1.5）；失效提示重建 |

---

## 文档与 PLAN 同步

实施完成后更新：

- [ ] [DESIGN.md](../../DESIGN.md) §5.9 补充通话管线、`call_*` 事件、`voice.settings` 通话字段；§3.3 多窗表增加 `call` 窗
- [ ] [语音能力计划](./2026-07-01-voice.md) V3/V5 指向本计划
- [ ] [MODELS.md](../../MODELS.md) 增加 Paraformer 识别与 CosyVoice 流式配置节
- [ ] [README.md](../../../README.md) 设置页/多窗一览增加「语音通话」

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0-draft | 2026-07-02 | 初稿：C1–C5 分期、MVP 半双工 → 全双工路线、坚持复刻音色的三段式管线、IPC/事件契约、风险表 |
| 0.1.1-draft | 2026-07-02 | 确认默认触发 `push_to_talk`；确认流式协议待用户供文档 |
| 0.2.0-draft | 2026-07-02 | 百炼 WebSocket STT/TTS 协议与服务端事件已确认，落入附录 A；Step 0 收敛为账号侧取值（Workspace ID / 开通计费） |
| 0.3.0-draft | 2026-07-02 | **C1–C4 落地同步**：勾选已完成 Task；记录实现偏差（流式主路径、vad 路径、public/vad 资源）；默认改为 `vad_auto` + barge-in；C5 待办保留 |

---

## 附录 B：已知实现偏差与运维备注

| 项 | 计划原述 | 实际 |
|----|----------|------|
| C2 TTS 播放 | `useVoicePlayback` + REST | `useCallStreamPlayback` + WS（REST 仅 fallback） |
| VAD 文件位置 | `src/voice/vad.ts` | `src/renderer/voice/vad.ts` + `useCallVad.ts` |
| VAD 静态资源 | vite-plugin-static-copy | `scripts/copy-vad-assets.mjs` → `public/vad/`（`pnpm dev`/`build` 前执行） |
| 默认通话模式 | `push_to_talk` | **`vad_auto` + `callAllowBargeIn: true`** |
| 老用户设置 | — | 已存 `push_to_talk` 的不会被默认覆盖；新装/未存字段者用新默认 |
| 转写 UI / 持久化 | C2/C5 | 事件已广播；UI 与 `callPersistTranscript` 入库未做 |
| Git commit | 各 Phase 拆分 commit | 代码已落地，commit 待用户确认后执行 |

---

## 附录 A：已确认的百炼 WebSocket 协议

> 据百炼官方文档（2026-07-02）。STT/TTS 共用一套「指令 + 事件」双工协议。

### A.1 连接与鉴权（两者通用）

```
Endpoint: wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
          （或旧域名 wss://dashscope.aliyuncs.com/api-ws/v1/inference）
Header:   Authorization: bearer <DASHSCOPE_API_KEY>
          X-DashScope-DataInspection: enable   （按需）
```

- 仅 **cn-beijing** 地域；复用现有百炼 Key（`resolveVoiceApiKey()`）。
- 每个 `run-task` 用新的 `task_id`（UUID）；`header.streaming: "duplex"`。

### A.2 STT — Paraformer 实时识别

**客户端指令：**

```jsonc
// 1) run-task
{ "header": { "action": "run-task", "task_id": "<uuid>", "streaming": "duplex" },
  "payload": { "task_group": "audio", "task": "asr", "function": "recognition",
    "model": "paraformer-realtime-v2",
    "parameters": { "format": "pcm", "sample_rate": 16000 },
    "input": {} } }
// 2) 二进制音频帧 × N（PCM 16bit 单声道 / raw-opus）
// 3) finish-task
{ "header": { "action": "finish-task", "task_id": "<uuid>", "streaming": "duplex" },
  "payload": { "input": {} } }
```

**服务端事件：**

- `task-started` — 可以开始发音频
- `result-generated` — 识别结果；关键字段 **`payload.output.sentence.sentence_end`**（`true` = 一句说完）与 `payload.output.sentence.text`（当前累积文本）。**通话轮次判定就用 `sentence_end === true`** 触发送入 Agent。
- `task-finished` / `task-failed`

### A.3 TTS — CosyVoice 流式合成（复刻音色）

**客户端指令：**

```jsonc
// 1) run-task
{ "header": { "action": "run-task", "task_id": "<uuid>", "streaming": "duplex" },
  "payload": { "task_group": "audio", "task": "tts", "function": "SpeechSynthesizer",
    "model": "<与复刻 target_model 一致>",
    "parameters": { "text_type": "PlainText",
      "voice": "<复刻 voice_id>",   // ← 直接填复刻 ID，用法同预设音色
      "format": "mp3", "sample_rate": 24000, "volume": 100, "rate": 1.0 },
    "input": {} } }
// 2) continue-task（可多次，边生成边推文本）
{ "header": { "action": "continue-task", "task_id": "<uuid>", "streaming": "duplex" },
  "payload": { "input": { "text": "<一句文本>" } } }
// 3) finish-task
{ "header": { "action": "finish-task", "task_id": "<uuid>", "streaming": "duplex" },
  "payload": { "input": {} } }
```

- 文本约束：单次 `continue-task` ≤2 万字符，累计 ≤20 万；两次间隔 <23s，否则超时断开。

**服务端事件与音频回传：**

- `task-started`
- **二进制 WebSocket 帧** = 合成音频块（按 `format` 编码）。**音频走二进制帧，不在 JSON 事件里** —— 渲染端按到达顺序入 Web Audio 队列播放。
- `result-generated`（JSON）— 时间戳 / 句级元数据（可选用于口型对齐，非音频）
- `task-finished` / `task-failed`

**中止（barge-in / 挂断）：** 主动 `finish-task` 或直接关闭 WebSocket 连接即停止合成。

### A.4 落到本计划的映射

| 协议要素 | 用在 | 影响的 Task |
|----------|------|------|
| `sentence_end` 判句 | 决定"用户说完"→送 Agent | C3-3、C4-1 |
| `continue-task` 逐句推文本 | Agent `text_delta` 分句喂 TTS | C3-1、C3-2 |
| 二进制帧音频 | `call_audio_chunk` 广播 + Web Audio 顺序播放 | C3-2 |
| 关连接即中止 | barge-in / 挂断 abort | C4-2、C2-2 `end()` |
| `voice`=复刻 voice_id | 全程保住自定义音色 | 贯穿 |

---

*执行时按 C1 → C2 → C3 → C4 → **C5（当前）** 顺序勾选 Task checkbox。C1–C4 代码已落地；剩余主要为 C5 打磨、实机验收、DESIGN 同步与 git commit。坚持自定义复刻音色是本计划的核心约束。*
