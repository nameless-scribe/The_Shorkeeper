# P4 · 录音转写与会议纪要实施计划

> 计划验收入口：逐阶段补齐 `pnpm test:p4` / `pnpm test:p4:ui`
>
> 阶段编号沿用 P 系列。P0 建任务闭环、P1 建个人模型、P3 建本地主动性，P4 给助理补上
> "听得懂一段录音"的输入通道，并把结果接回 P0 的待办与承诺。P2（外部连接器）仍为已取消。

当前状态（2026-09-13）：**未开工**。本文是开工前的契约，不是验收记录。

---

## 1. 目标与边界

**要解决的**：把一段本地录音变成可检索、可追溯、可执行的东西——逐字稿进工作区，纪要里的待办进 P0，而不是给用户丢一坨文本。

**同时解决的**：聊天框至今不能语音输入（`useVoiceInput` 只接在语音通话页），而配置里 `pushToTalk` / `sttAutoSend` 两个设置项早就定义好却从未被任何代码读取。

**不解决的**：见第 7 节。

---

## 2. 供应商调研结论（2026-09-13）

### 2.1 阿里云百炼：完整支持，且不需要对象存储

| 项 | 结论 |
|---|---|
| 同步识别 | `qwen3-asr-flash`，**≤5 分钟 / ≤10 MB**，一次请求拿结果，无需轮询 |
| 异步识别 | `paraformer-v2`、`qwen3-asr-flash-filetrans` 等，**≤12 小时 / ≤2 GB** |
| 传文件方式 | `file_urls` 公网 URL、**`data:<mediatype>;base64,<data>` 内联**、SDK 专用的 `file://` 绝对路径 |
| 说话人分离 | `parameters.diarization_enabled = true`，句子级返回 `speaker_id`；**仅支持单声道**，开启时官方建议 ≤2 小时 |
| 格式 | AAC / WAV / MP3 等主流容器，任意采样率 |
| 语言 | 中文（含方言）、英日韩德法俄等 30+ |

**最关键的一条**：base64 内联可用，**因此不需要接 OSS，也就不触碰 P2 已取消的外部连接器边界**。这是本计划成立的前提。

`file://` 路径只在 Python / Java SDK 下可用（SDK 内部即读文件转 base64），本仓库直连 REST，走 base64。

**异步调用流程**：

```
POST {workspace-host}/api/v1/services/audio/asr/transcription
  Authorization: Bearer {apiKey}
  X-DashScope-Async: enable
  { "model": "paraformer-v2",
    "input": { "file_urls": ["data:audio/mpeg;base64,..."] },
    "parameters": { "diarization_enabled": true, "language_hints": ["zh"], "channel_id": [0] } }
→ { task_id, task_status: "PENDING" }

POST {workspace-host}/api/v1/tasks/{task_id}
→ task_status ∈ PENDING | RUNNING | SUCCEEDED | FAILED
→ SUCCEEDED 时给出 transcription_url（有效期 24 小时）

GET transcription_url
→ 句子数组，每句含 begin_time / end_time（毫秒）、text、words[]，
   开启分离时含 speaker_id
```

端点主机与现有 chat base URL 同源（`{workspace}.cn-beijing.maas.aliyuncs.com`），
可直接沿用 `src/config/voice.ts` 里 `deriveTtsEndpointFromModelBaseUrl` 的同款推导方式，
不要求用户再填一个地址。

### 2.2 DeepSeek：不支持，且不在本计划考虑范围

DeepSeek API 只接受文本输入，没有原生 ASR 或语音模式。社区方案一律是"外挂第三方 STT
再把文本喂给 DeepSeek"。

结论：**转写能力只能来自百炼**。若日后用户把对话模型换成 DeepSeek，转写仍走百炼，
即语音供应商与对话供应商解耦——这一点必须在配置层体现，见 4.3。

---

## 3. 为什么不能只做成一个技能

技能是**编排层**：`SKILL.md` 的 frontmatter 声明 `allowedTools`，本质是告诉模型
"按这个流程调这些已注册的工具"。它不能新增能力。

当前没有任何工具能把音频变成文字，技能就没有东西可编排。因此必须分三层，自下而上：

| 层 | 产出 | 没有它会怎样 |
|---|---|---|
| L1 能力 | `src/voice/bailian-file-asr.ts`：同步与异步两条转写通道 | 无 |
| L2 工具 | `transcribe_audio`：声明副作用、风险、幂等与完成证据，逐字稿落工作区 | 模型无法调用 |
| L3 技能 | `meeting-notes`：转写 → 读稿 → 出纪要 → 确认后写入 P0 | 每次都要用户手工串流程 |

技能是最后也最省事的一层，但只有它能把"会议纪要"变成产品而不是一个转写器。

### 3.1 转写与总结必须是两步

**不要**做成一个"上传录音直接给纪要"的工具。理由：

- 转写慢且按时长计费；总结便宜且经常要重来（"再详细点"、"按项目分组"、"补上时间线"）
- 合成一步意味着每次调整纪要格式都要重新转写一次
- 逐字稿本身有独立价值（可检索、可引用、可回溯"他到底怎么说的"）

所以：`transcribe_audio` 只产出逐字稿文件并返回路径；纪要由模型读这份文件生成。

### 3.2 逐字稿不能直接进上下文

一小时会议的逐字稿轻松上万字。工具返回**产物路径 + 摘要元信息**（时长、说话人数、
分段数、前 200 字预览），模型按需用现有文件工具读取片段。这与 P1 "不复制正文"、
RAG `catalog` 模式的既有取舍一致。

---

## 4. 数据与契约

### 4.1 新增持久化

新增 migration `0027_audio_transcripts.sql`，一张表：

| 列 | 说明 |
|---|---|
| `id` | uuid |
| `source_path` | 工作区相对路径（音频） |
| `source_hash` | 音频内容 SHA-256，**幂等键**：同一文件不重复转写 |
| `duration_ms` / `size_bytes` / `channels` | 音频元信息 |
| `mode` | `sync` / `async` |
| `model` | 实际使用的模型名 |
| `provider_task_id` | 异步任务 id，可空 |
| `status` | `pending` / `running` / `succeeded` / `failed` / `cancelled` |
| `transcript_path` | 逐字稿产物的工作区相对路径，可空 |
| `speaker_count` | 分离出的说话人数，可空 |
| `error` | 失败原因，限长脱敏 |
| `sensitivity` | 默认 `sensitive`，见 4.4 |
| `created_at` / `updated_at` / `completed_at` | |

**不存逐字稿正文**，只存路径。理由同 P1：账本不复制正文。

`source_hash` 作幂等键意味着：同一个录音重复拖进来，直接返回已有逐字稿，不重复计费。

### 4.2 跨重启恢复

异步任务可能跑几十分钟，期间应用可能退出。`provider_task_id` 落库后，
启动时由一个恢复流程继续轮询未完成的任务——沿用 P0 `TaskRun` 的恢复思路，
不新建平行机制。轮询间隔退避，有最大重试次数与总时长上限（超时记 `failed` 并保留 task_id 供人工查询）。

### 4.3 供应商配置与对话模型解耦

`src/config/voice.ts` 增加 `asrFileEndpoint` 与 `asrFileModel`，解析顺序与现有 TTS 端点一致：
应用内设置 → `.env` → 从 chat base URL 推导 → 官方默认。

**必须解耦**：用户可能把对话模型换成 DeepSeek 或其他供应商，转写仍走百炼。
现有 `resolveTtsEndpoint` 已是这个形状，照抄即可，不要把 ASR 端点绑到 `modelConfig`。

### 4.4 敏感性默认从严

会议录音比聊天文本敏感得多：可能含他人声音、未公开的商业信息。

- 转写记录默认 `sensitivity = 'sensitive'`
- 逐字稿**不自动进 RAG 知识库**，需用户显式归档
- 沿用 P1 已有的 `model_use_policy` 概念：标记为 `deny` 的转写稿不送远端 embedding
- 音频本身**不上传到任何非模型供应商的地方**（本计划不引入对象存储）
- 设置页明确告知：转写会把音频发送给模型供应商

### 4.5 附件类型必须分类

现在的附件语义是"读进来给模型看"。音频不能这样处理，否则模型会试图把 mp3 当文本读。

- `WORKSPACE_IMPORT_EXTENSIONS` 扩展出独立的 `WORKSPACE_AUDIO_EXTENSIONS`（`.mp3` / `.wav` / `.m4a` / `.aac` / `.flac` / `.ogg`）
- `WorkspaceAttachment` 增加 `kind: 'text' | 'office' | 'audio'`
- 上下文构建遇到 `audio` 附件时，注入的是"这是一个待转写的音频文件，路径 X"，而不是文件内容
- 音频不受 `MAX_WORKSPACE_IMPORT_BYTES = 20MB` 约束，单独设上限（建议 200MB，对应约 4 小时 m4a）

---

## 5. 六个实施阶段

### P4.0 — 契约、端点与固定样本（2–3 天）

- 固定转写结果的内部表示：句子数组（`beginMs` / `endMs` / `text` / `speakerId?`），
  与百炼返回结构之间的映射写成纯函数并测试。
- 固定逐字稿的 Markdown 产出格式：带时间戳与说话人标签，同一说话人连续发言合并。
- 端点推导、模型名、语言提示、分离开关的解析规则，含缺配置时的清晰报错。
- 固定样本：单声道双人对话、无人声静音段、超长静默、单句极短音频、非法容器、
  供应商返回 FAILED、轮询超时、同一文件重复提交。
- 建立 `pnpm test:p4`。

**阶段出口**：映射与格式化有确定输出；不改变任何生产行为；不发出任何真实网络请求。

### P4.1 — 聊天框语音输入（2–3 天）

与转写文件解耦，可独立发布。所有零件已存在，只是没接线。

- `useVoiceInput` 接入 `InputBar`，加麦克风按钮与录音中的电平反馈。
- 激活两个休眠设置：`pushToTalk`（按住说话 vs 点击切换）、`sttAutoSend`（识别完是否自动发送）。
- 设置页 → 语音，补上这两项的 UI。
- 识别结果回填输入框，**默认不自动发送**，用户可改。识别失败保留已输入文本，不清空。
- 录音中禁用发送按钮；切换会话或窗口失焦时安全终止录音。

**阶段出口**：真机上按住说话能把识别文本填进输入框；`pushToTalk` 与 `sttAutoSend`
两种组合均符合预期；录音期间崩溃或切窗不残留麦克风占用。

### P4.2 — 短音频同步转写（3–4 天）

- `src/voice/bailian-file-asr.ts` 实现同步通道：`qwen3-asr-flash`，base64 内联，单次请求。
- 前置校验：时长 ≤5 分钟、体积 ≤10 MB，超限直接走 P4.3 的异步通道（或在 P4.3 完成前明确报错）。
- migration `0027` 与 Repository。
- 工具 `transcribe_audio`：声明为有副作用（写文件、产生费用）、非幂等对外但以
  `source_hash` 去重、可取消、完成证据为逐字稿文件的 SHA-256。
- 附件分类（4.5），拖拽 mp3 进聊天框不再被当文本读。

**阶段出口**：5 分钟内的录音能从聊天框拖入并产出逐字稿文件；重复拖同一文件不重复计费；
工具在权限确认、取消、失败三条路径上均符合 S3 工具契约。

### P4.3 — 长音频异步转写与跨重启恢复（4–6 天）

- 异步通道：提交 → 落 `provider_task_id` → 退避轮询 → 下载 `transcription_url` → 落逐字稿。
- 说话人分离：`diarization_enabled`，单声道校验，多声道时明确降级并告知用户。
- 启动恢复：未完成任务继续轮询；超过总时长上限记 `failed` 并保留 task_id。
- 进度可见：运行记录页能看到"转写中 / 已完成 / 失败"，与 P0 `TaskRun` 同一套展示。
- `transcription_url` 24 小时有效，下载失败要能重试提交查询而不是重新转写。

**阶段出口**：一小时会议录音能完整转写并带说话人标签；转写途中关闭应用，重启后能继续并最终完成；
供应商返回 FAILED 时用户看到可理解的原因而不是原始报错。

### P4.4 — 会议纪要技能与 P0 衔接（3–4 天）

- `skills/meeting-notes/SKILL.md`，`trigger: auto`，`matchKeywords` 含"会议纪要 / 整理录音 / 总结这段录音"等。
- 流程：定位音频 → `transcribe_audio` → 读逐字稿 → 产出纪要（议题 / 结论 / 待办 / 负责人 / 截止）
  → **向用户确认** → 确认后调 `create_user_task` 与 `manage_commitments` 落库。
- 纪要中每条待办必须能回指逐字稿的时间戳，做到可追溯。
- 不确认不写入；不自动给他人创建承诺（`promisedTo` 只记录，不代他人承诺）。

**阶段出口**：一段真实会议录音能走完"转写 → 纪要 → 确认 → 待办入库"；
生成的承诺随后能被 P3 的承诺守望正常跟进；用户拒绝确认时不产生任何领域数据。

### P4.5 — 回归与真实使用（2–3 天 + 观察）

- `pnpm test:p4` 覆盖映射、格式化、幂等、恢复、取消、失败路径、附件分类。
- `pnpm test:p4:ui` 验证聊天框录音按钮与转写进度的各状态。
- `pnpm test:ui:strict`（P4.1 引入新的 hook 状态，必须过严格模式）。
- 全量 `pnpm test`、`pnpm typecheck`、`pnpm build`、Electron 生命周期 smoke。
- 真实使用记录：转写准确率主观评分、说话人分离是否可用、单次耗时与费用、
  纪要中待办的准确率与误报率。

**阶段出口**：至少 5 场真实会议走通全流程；所有"好用"的结论来自真实录音而非测试桩。

---

## 6. 会影响哪些现有模块

| 模块 | 影响 | 风险 | 控制方式 |
|---|---|---|---|
| `src/voice/` | 新增文件转写通道，与实时 STT 并存 | 中 | 新文件，不改 `bailian-stt.ts`；共用 API Key 解析 |
| `src/config/voice.ts` | 新增 ASR 端点与模型配置 | 低 | 照搬 `resolveTtsEndpoint` 的解析顺序 |
| 数据库 | 新增一张转写账本表 | 中 | 单一增量 migration、双 adapter、临时库测试 |
| 工作区 / 附件 | 新增音频类别与独立体积上限 | 中高 | `kind` 字段显式分类；上下文构建对 audio 走专门分支 |
| `InputBar` / `ChatPage` | 新增麦克风按钮与录音态 | 中 | 复用 `useVoiceInput`；按 P3 复审的教训，状态逻辑抽纯函数，过 `test:ui:strict` |
| P0 任务 / 承诺 | 纪要写入待办与承诺 | 中 | 只经现有工具写入，确认后才落库，不新增写路径 |
| 费用 | 转写按时长计费 | 中 | `source_hash` 幂等；提交前显示预估时长；失败不重复扣 |

---

## 7. 明确不做

- 不接对象存储（OSS）或任何云盘；音频只经 base64 发给模型供应商。
- 不做实时会议转录（边开会边转写）——那是另一套实时流式链路，本计划只处理已有的录音文件。
- 不做声纹识别（认出"这是张三"）；说话人分离只给匿名 `speaker_id`。
- 不自动把逐字稿灌进 RAG 知识库。
- 不在用户确认前创建任何待办、承诺或日程。
- 不为转写单独建一套运行记录 / 通知体系，复用 P0 `TaskRun` 与 P3 事件账本。
- 不支持 DeepSeek 等不提供 ASR 的供应商做转写；对话模型与转写供应商解耦。

---

## 8. 推荐开工顺序与停线条件

建议顺序：**P4.1 → P4.0 → P4.2 → P4.3 → P4.4 → P4.5**。

把 P4.1（聊天框语音输入）提到最前，理由：它与转写完全解耦、零件全部现成、半天到两天可见效果，
而且顺手激活两个躺了很久的死配置。先拿到一个能用的东西，再啃转写。

出现以下任一情况立即停止扩大范围：

- 同一音频重复转写产生重复计费；
- 逐字稿正文进入数据库或被整段注入模型上下文；
- 音频附件被当作文本读取；
- 异步任务在应用重启后丢失，无法继续也无法查询；
- 未经用户确认就写入待办、承诺或修改任何领域真源；
- 转写失败后用户只看到供应商原始报错；
- 为了赶长音频而在 `InputBar` 里引入新的带副作用 state updater（见 P3 §9.6 的教训）。

---

## 9. 待确认

- **计费**：同步与异步两条通道的单价与计费粒度需在开工前查清并写进本节，
  P4.2 的"提交前显示预估"要用到。
- **并发**：本地 base64 调用官方标注 100 QPS 上限且不可扩容；个人单机场景远不会触及，
  但异步轮询默认 20 QPS，恢复流程若同时有多个任务需自行限流。
- **模型选型**：`paraformer-v2` 与 `qwen3-asr-flash-filetrans` 在中文会议场景的准确率与价格差异，
  建议 P4.3 开工前用同一段真实录音各跑一次再定，不要凭文档选。
