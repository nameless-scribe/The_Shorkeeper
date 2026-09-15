# P8 · 图片理解与 OCR 实施计划

> 计划验收入口：逐阶段补齐 `pnpm test:p8`
>
> 阶段编号沿用 P 系列。P5.0 把 PDF 的表格和图片读了出来，但助理仍然"看不见"图：照片、扫描图纸、
> 用户随手拍的一张截图，都只有路径没有内容。P8 给助理接上眼睛——用百炼的通义千问视觉模型。
> P6（追问）与 P7（数据源）不依赖本阶段；本阶段依赖 P5.0 已完成的 `.assets/` 抽图。

当前状态（2026-09-15）：**P8.0–P8.3 代码完成，真实调用探针与真实使用待用户**（见第 10 节）。
用户决定（2026-09-15）：**接大模型，先试用千问的视觉模型**，不做本地 OCR 运行时。
用户已同意（2026-09-15）第 3 节与第 8 节的主张：看图是工具不换对话模型、没问不看、同图同问不重复付费、
发送前有开关、送去识别的图不压。开工顺序按 `P5-P7-ROADMAP.md`，目前尚未推进到 P8。

---

## 1. 目标与边界

**要解决的**：用户能把图片交给助理并就图片提问，助理的回答基于图片内容而不是猜。具体三件事：

1. 上传或放进工作区的图片（照片、截图、图纸扫描）可以被提问："这是什么设备""这张图里写了什么"。
2. P5.0 抽出来的 PDF 页面图（扫描件没有文字层时唯一的内容）可以被看：读扫描图纸的标题栏、材料、尺寸。
3. 需要精确提取文字时（标题栏、表格、票据），走 OCR 专用模型拿结构化结果，而不是让通用模型"念"。

**同时解决的**：`convert_to_markdown` 对扫描件只能写一句"未支持 OCR"；有了本阶段，这个分支能接上视觉识别。

**用户已明确的边界（2026-09-15）**：
- 供应商定为**阿里云百炼的通义千问视觉模型**，先试用；不引入本地 OCR 或视觉运行时（不装 PaddleOCR、Tesseract 之类）。
- 与对话模型是**两个模型 ID、同一套凭证**：对话仍用文本模型，看图只在需要时单独调视觉模型一次。不把整条对话换成视觉模型。

**不解决的**：见第 7 节。

---

## 2. 供应商与模型选型（2026-09-15，按官方文档）

### 2.1 结论：`qwen3-vl-plus` 起步，`qwen3-vl-flash` 作为省钱档

| 项 | `qwen3-vl-plus` | `qwen3-vl-flash` |
|---|---|---|
| 输入 / 输出（≤32K） | 1 元 / 10 元 每百万 token | 0.15 元 / 1.5 元 |
| 32K–128K | 1.5 / 15 | 0.3 / 3 |
| 免费额度 | 100 万 token | 100 万 token |
| 上下文 | 262,144 token | 同系列 |
| 输入模态 | 文本、图片、视频 | 同 |
| 思考模式 | 支持，可关 | 支持，可关 |
| 限流（北京） | 3,000 RPM / 500 万 TPM | 同量级 |

选 plus 起步是因为图纸标注、手写、复杂表格这类任务差距主要在识别精度，先用强的把"能不能"验证清楚，再考虑是否降到 flash。
两者接口完全一致，模型 ID 做成设置项，切换不改代码。

**图片计费规则**（决定了本计划里所有的像素上限）：每张图的 token 数 = `宽 × 高 / (32 × 32) + 2`。

| 图片尺寸 | 约 token | 按 plus 输入价 |
|---|---|---|
| 1024 × 1024 | 1,026 | 0.001 元 |
| 2048 × 1536 | 3,074 | 0.003 元 |
| 2560 × 2560（上限档） | 6,402 | 0.006 元 |
| 4948 × 7000（600 dpi 整页，不缩） | 33,830 | 0.034 元 |

一页 600 dpi 图纸原样送过去也才 3 分钱，**贵的不是图片，是输出**（10 元/百万）。所以控制成本的手段是限制输出长度和调用次数，
不是把图压糊——P5.0 刚为清晰度返过工，这里不能再犯。

### 2.2 接口：与现有对话完全同一条通道

- 协议：OpenAI 兼容 `POST {baseUrl}/chat/completions`，`Authorization: Bearer <百炼 Key>`。**复用设置 → API 设置里的百炼接入点与 Key**，只新增一个"视觉模型 ID"。
- 图片放在 `messages[].content[]` 里：`{ "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } }`，与 `{ "type": "text", "text": "…" }` 混排；一条消息可带多张图。
- 本地文件一律走 **base64 data URL**，不上传到任何对象存储，不暴露公网 URL。
- 支持格式：PNG、JPEG、WebP（官方明确）。BMP、GIF 等先在本地转成 PNG 再送。
- 单图最大 1600 万像素；超出本地缩小。
- 关闭思考模式（`enable_thinking: false`）：看图回答不需要长推理，思考 token 按输出计费。
- 流式：支持，但看图是工具调用、一次拿完，**不流式**。
- 请求 ID：响应头 / body 里的 `id` 记进运行记录，与 P4 转写一样成功失败都记。

### 2.3 OCR 专用模型：`qwen3.5-ocr`（P8.4，可选）

百炼另有 OCR 专用模型，官方推荐用于"文档、表格、试卷、手写"的文字提取，七种内置任务：
通用识别、**高级识别（带旋转矩形坐标的文字行）**、关键信息抽取（可给 JSON schema）、**表格解析（HTML）**、文档解析（LaTeX）、公式、多语言。
像素范围 3,072 至 8,388,608（约 2896 × 2896），超出自动缩。

它的价值是"带坐标的文字行"：接进 P5.0 的版面分析（文字按坐标落格），扫描表格也能还原成 Markdown 表格。
但 **OpenAI 兼容模式下 `ocr_options` 这类参数要靠手写提示词模拟**，DashScope 原生接口才有完整参数——
本阶段先用通用 VL 模型把主路径跑通，OCR 专用模型作为 P8.4 单独评估，届时决定走哪种接口。

### 2.4 供应商与对话模型必须解耦

与 P4 §2.4 同一条原则：对话模型可以换成 Claude 代理或别的兼容接口，看图仍走百炼。
因此视觉模型的接入点与 Key **默认复用**百炼配置，但允许单独指定（用户对话用了别家模型时必填）。

### 2.5 待真实调用复核的四件事

- base64 单图的大小上限（文档没写明；常见写法是 10 MB，P8.0 用一张 8 MB 的 PNG 实测）。
- 业务空间专属接入点（`llm-xxxx.cn-beijing.maas.aliyuncs.com`）是否已开通 VL 模型；不通就退到 `dashscope.aliyuncs.com/compatible-mode/v1`。
- `enable_thinking` 在兼容模式下是否被接受（文档写在 DashScope 参数里）；不接受就不传。
- 图片 token 的实际计数与公式是否一致（看 `usage.prompt_tokens`），决定预算估算能不能信。

---

## 3. 为什么是一个工具，不是换模型

### 3.1 看图是"外部识别再落成文字"

与 P4 的转写同构：录音 → 文稿进对话；图片 → 描述 / 识别结果进对话。对话模型始终只收文字，好处是：

- 对话模型可以随便换（Claude 代理、别家兼容接口），看图能力不受影响；
- 每次看图的成本、耗时、请求 ID 都记在工具调用上，可审计；
- 图片不会随着历史消息反复送进上下文（一张 2K 图 3,000 token，带着聊十轮就是 3 万）。

### 3.2 结果落盘，不重复识别

同一张图、同一个问题，第二次不该再花钱。识别结果写成工作区的 sidecar 文件
`<图片名>.vision.md`（描述）或 `<图片名>.ocr.md`（文字提取），文件头记模型、时间、问题、请求 ID。
`look_at_image` 先查 sidecar：同问题命中就直接返回，不调接口；用户要"重新看"时传 `refresh: true`。

### 3.3 问题要带着图走，不是先描述再问

不做"上传即自动描述"。用户没问，助理不看——一张图可能 3,000 token 输入，自动描述既花钱又常常答非所问。
附件介绍行只告诉模型"这是图片、路径在哪、需要看时用 `look_at_image`"，措辞与录音附件一致，不含技能触发词。

---

## 4. 数据与契约

### 4.1 不新增持久化

sidecar 落工作区，由现有 artifact 机制记录；请求 ID 与 token 用量写进现有的运行记录（`TaskRun` step 的 metadata），不加表。
设置项走 `app_settings`（模型 ID、是否允许发送图片、单次最大像素），与 P4 的 ASR 设置同一套读写。

### 4.2 `look_at_image` 的契约

- `category: 'doc'`，`requiresPermission: ['filesystem:read', 'filesystem:write', 'network']`（`network` 与 `web_search` 同一标志，已存在）。
- `sideEffects`：`risk: 'low'`、`idempotent: true`（同图同问命中缓存）、`supportsPreview: false`、`reversible: 'manual'`、`evidence: 'artifact'`（sidecar 是产物）。
- 参数：`paths[]`（工作区内图片相对路径，1 至 6 张）、`question`（必填，不允许空问）、`mode: 'describe' | 'read_text' | 'answer'`（默认 `answer`）、`refresh?`。
- 上限：单张 ≤ 20 MB 文件、≤ 1600 万像素（超出本地缩到最长边 3600，与 P5.0 抽图上限一致）；单次合计 ≤ 6 张；`max_tokens` 默认 1,024，`read_text` 模式 4,096。
- 输出：识别文字（`output`）+ `metadata { model, requestId, promptTokens, completionTokens, cached }` + sidecar artifact。
- 失败分类：未配置 → `permission_denied` 类的明确提示（去哪里配）；4xx → `external_service_failure` 带供应商错误码；超时 30 秒 → `timeout`；取消传播 `ctx.signal`。
- **不确认不发送**：设置里"允许把图片发送到视觉模型"默认**关**；关着时工具返回明确提示，不静默失败。这是隐私边界，与 P4 §4.4 同一态度。

### 4.3 图片附件分类

`WorkspaceAttachmentKind` 加 `'image'`：白名单 `.jpg .jpeg .png .webp .bmp .gif`，导入上限 20 MB，
不并入文本白名单（图片不是可读内容），不预解析。上下文介绍行：
`- 照片.jpg → 工作区: 照片.jpg（1.2 MB，这是图片，需要内容时用 look_at_image 提问，不要用 read_file 读取）`。
选择文件对话框新增"图片"分组。聊天里的附件卡片对 `.jpg/.png` 显示缩略图（`sk-asset:` 协议已允许 `img-src`）。

### 4.4 扫描 PDF 的衔接

`convert_to_markdown` 对无文字层 PDF 的输出已经是"说明 + 各页图片引用"（P5 §11.3）。本阶段不改转换器，
只在技能规则里补一条：遇到这种 `.md`，用户问内容时用 `look_at_image` 看对应页的图片，`read_text` 模式抽文字。
每页图最长边 3600，token 约 6,000，一页几分钱。

### 4.5 预算与节流

- 单次运行（一个 run）内看图调用上限 10 次、图片合计 30 张，超出报错提示分批。
- 图片 token 按公式预估写进 metadata，运行记录页能看到"这次看图花了多少"。
- 不做后台批量识别；所有调用都由对话中的工具触发。

---

## 5. 实施阶段

### P8.0 — 契约、客户端与固定样本（1–2 天）

- L1 纯函数：`src/vision/contract.ts`（参数校验、像素与 token 估算、sidecar 格式）、`src/vision/image-prep.ts`（格式判断、BMP/GIF 转 PNG、按像素上限缩放，用 `@napi-rs/canvas`）。
- 客户端 `src/vision/bailian-vl.ts`：组 OpenAI 兼容请求、base64 编码、超时与取消、响应解析与请求 ID。用 vitest 假服务器测成功 / 4xx / 超时 / 取消。
- 真实调用探针 `scripts/vision-probe.ts`：拿一张照片、一页图纸、一张 8 MB PNG 各调一次，记录 §2.5 的四件事，写进第 10 节。
- 固定样本：`docs/p8-samples/`（设备照片、图纸页、截图各一，自动化只用小图，不入库大文件）。
- 建立 `pnpm test:p8`。

**阶段出口**：探针脚本对三张图都拿到回答与 `usage`，token 计数与公式误差在 5% 内。

### P8.1 — 图片附件（1–2 天）

- 白名单、分类、上限、上下文介绍行、对话框分组、附件卡片缩略图（4.3）。
- 契约测试：图片不并入文本白名单、介绍行不含技能触发词、`read_file` 读图片时返回"这是图片，请用 look_at_image"。

**阶段出口**：拖一张 `.jpg` 进聊天框，附件卡片显示缩略图，模型知道要用哪个工具、不会去 `read_file`。

### P8.2 — `look_at_image` 工具与设置（3–4 天）

- 工具（4.2）、sidecar 缓存、运行记录 metadata。
- 设置 → 插件（或新的"视觉"段落）：允许发送开关（默认关）、视觉模型 ID（默认 `qwen3-vl-plus`）、可选独立接入点与 Key（掩码回传、留空不改，与 ASR 凭证段一致）、单张最大像素。
- 技能 `image-qa`：`trigger: auto`，触发词 `看看这张图 / 这张图 / 图片里 / 截图 / 照片 / 图纸`，`allowedTools: [list_dir, look_at_image, read_file]`；规则：没问题不看图、一次最多 6 张、回答引用图片文件名、识别不清就说不清。
- 契约测试：成功、未开启开关、未配置模型、4xx、超时、取消、缓存命中、超过 6 张、`read_file` 读图被拒。

**阶段出口**：上传一张设备照片问"这是什么"，得到基于图片的回答；同一问题再问一次不产生第二次请求（运行记录里可见 `cached: true`）。

### P8.3 — 扫描 PDF 衔接（1 天）

- `doc-to-markdown` 技能补规则（4.4）；`look_at_image` 的 `read_text` 模式对图纸页做一版提示词（标题栏字段、尺寸标注按行列出、不确定的标"?"）。
- 真实样本：用户桌面的 6 页图纸扫描件（`1(1).pdf`），逐页 `read_text`，人工核对标题栏 5 个字段的准确率。

**阶段出口**：对扫描图纸问"这个件什么材质、图号多少"能答对；答不准的地方模型明确说不确定而不是编。

### P8.4 — OCR 专用模型评估（可选，2 天）

- 用 `qwen3.5-ocr` 的"高级识别"拿带坐标的文字行，喂给 P5.0 的版面分析（文字按坐标落格），看扫描表格能否还原成 Markdown 表格。
- 比较同一批样本上 VL 通用模型 `read_text` 与 OCR 专用模型的准确率与成本，写进第 10 节，再决定要不要把它接成 `look_at_image` 的 `read_text` 后端。
- 若 OpenAI 兼容模式拿不到坐标，评估走 DashScope 原生接口的代价（多一套请求格式、同一把 Key）。

### P8.5 — 回归与真实使用（1–2 天 + 观察）

- `pnpm test:p8`、全量、`typecheck`、`build`、`test:ui:strict`（改了设置页与附件卡片）。
- 真实使用记录：至少 5 张照片提问、2 份扫描件读标题栏、1 次缓存命中、1 次开关关闭时的拒绝提示。

---

## 6. 会影响哪些现有模块

- `src/workspace/allowed-extensions.ts`、`src/shared/types.ts`、`src/shared/ipc-validation.ts`：`image` 分类。
- `src/workspace/import.ts`：介绍行；`src/tools/file/read-file.ts`：读图片时的引导错误。
- `src/renderer/components/FileAttachmentCard*`：缩略图；`file-attachment-utils.ts`：扩展名与图标。
- `src/vision/`：新目录（契约、图片预处理、客户端）；`src/tools/vision/look-at-image.ts`：新工具；`src/tools/builtin.ts`、`src/config/plugins.ts`、`src/agent/stable-context.ts`：注册与说明。
- `src/config/vision.ts` + `electron/ipc/vision.ts` + 设置页：开关、模型 ID、独立凭证。
- `skills/image-qa/SKILL.md` 新增；`doc-to-markdown` 补规则；契约测试技能列表与验收脚本技能数各加 1。
- `.env.example`：`VISION_MODEL`、可选 `VISION_API_KEY` / `VISION_BASE_URL`。
- `docs/DESIGN.md`、`docs/使用说明.md`、`docs/MODELS.md`：视觉模型的配置与费用说明。

---

## 7. 明确不做

- **不做本地 OCR / 视觉运行时**。用户已定接云端模型；本地模型体积与安装包、显存都不合适。
- **不把对话模型换成视觉模型**。对话仍只收文字，看图是工具（§3.1）。
- **不自动描述上传的图片**。没问就不看（§3.3）。
- **不做视频**。接口支持，但没有需求，`video_url` 一律不发。
- **不做图片生成、不做图片编辑**。
- **不在知识库导入时识别图片**。知识库仍只收文字；扫描件想进知识库，先用 `look_at_image` 出文字再导入 `.md`。
- **不把图片放进长期上下文**。识别结果进对话，图片本身不进。

---

## 8. 推荐开工顺序与停线条件

建议顺序：**P8.0 → P8.1 → P8.2 → P8.3 → P8.5**，P8.4 看 P8.3 的结果再定。

在整体路线里的位置：P6.0 与 P6.1（`ask_user`）之后、P5.1 之前——用户对图纸的需求是现在的，而 P8 只依赖 P5.0，
不等 P6 也能开工；放在 `ask_user` 之后是为了让"看不清要不要重拍"这类追问有统一的问法。见 `P5-P7-ROADMAP.md`。

出现以下任一情况立即停止扩大范围：

- 图片在"允许发送"开关关闭的情况下被发出；
- 同一图片同一问题两次调用了接口（缓存失效）；
- 为了省钱把送去识别的图片压到最长边 1280 以下（P5.0 的教训）；
- 工具在没有问题（`question` 为空）的情况下被调用并产生费用；
- 识别结果被写进长期记忆或个人事实（低置信推断不得直接写成用户事实，P0/P1 原则）；
- 引入第二个视觉供应商或本地模型；
- 一次运行内看图超过 10 次仍未报错。

---

## 9. 待确认

- §2.5 的四件事（base64 上限、业务空间接入点是否开通 VL、`enable_thinking` 兼容模式是否可传、token 计数与公式）。P8.0 探针解决。
- 附件卡片缩略图走 `sk-asset:` 还是新协议：看 `appearance-assets.ts` 的路径范围能否覆盖工作区。
- OCR 专用模型经 OpenAI 兼容模式能拿到多少（§2.3）。P8.4 时评估。

---

## 10. 实施记录

（开工后按"症状 → 证据 → 根因 → 修法"逐节追加，格式与 P4 第 10 节一致。）

---

## 参考（2026-09-15 查阅）

- 视觉理解总览：https://help.aliyun.com/zh/model-studio/vision
- 视觉模型输入规则与推荐：https://help.aliyun.com/zh/model-studio/vision-model
- `qwen3-vl-plus` 模型信息（上下文、限流、价格）：https://help.aliyun.com/zh/model-studio/qwen3-vl-plus
- 模型价格总表：https://help.aliyun.com/zh/model-studio/model-pricing
- 通过 OpenAI 接口调用千问 VL：https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai
- OCR 专用模型：https://help.aliyun.com/zh/model-studio/qwen-vl-ocr

### 10.1 P8.0–P8.3 代码完成，真实探针待用户（2026-09-15）

用户要求"一直推进到结束"，P8 的代码部分用假服务器与现生成的小图测完；§2.5 的四件事要真实调用才能复核，
探针脚本已就绪，等用户开通 `qwen3-vl-plus` 并把三张样图放进 `docs/p8-samples/` 后跑 `pnpm vision:probe`。
与计划不同或计划没写的三处：

- **多张图一问只写一份答案，落到每张图的 sidecar 里**（`images` 字段记同批图片）。缓存命中要求图片集合、问题、模式三者都相同，
  单张图的旧结果不会被多张图的问题误用。
- **设置放在"设置 → 语音"页底部**（与录音转写凭证并列），而不是插件页：两者都是"外部识别服务 + 凭证 + 开关"。
- **一次运行内的预算在进程内按 runId 记**（10 次 / 30 张），不落库；超过返回明确错误而不是静默截断。

| 层 | 文件 | 说明 |
|---|---|---|
| 契约 | `src/vision/contract.ts` | 参数校验（1–6 张、必须有问题、三种模式）、token 公式 宽×高/1024+2、超像素上限缩到最长边 3600（不再低）、sidecar 路径（`.vision.md` / `.ocr.md`）与头部 JSON 的写读、三种模式的提示词（读文字：逐字、表格按行、图纸先标题栏、认不清写「?」） |
| 预处理 | `src/vision/image-prep.ts` | PNG / JPEG / WebP 且像素不超时**原样送**（不重编码）；BMP / GIF 转 PNG；超限等比缩后转 PNG |
| 客户端 | `src/vision/bailian-vl.ts` | OpenAI 兼容 `chat/completions`，`content[]` 混排文字与 data URL，`enable_thinking: false`、不流式；30 秒超时、取消传播；错误分四类（http / timeout / cancelled / network / malformed）带状态码与请求 ID |
| 设置 | `src/config/vision.ts`、`electron/ipc/vision.ts`、`VisionSettingsSection.tsx` | 开关默认关；模型 ID 默认 `qwen3-vl-plus`；接入点与 Key 留空复用 API 设置里的百炼配置（对话协议不是 OpenAI 兼容时要求单独填）；Key 加密存、只回传掩码；单张最大像素可调（下限 100 万） |
| 工具 | `src/tools/vision/look-at-image.ts` | `risk: low`、幂等、`evidence: artifact`；顺序：参数 → sidecar 命中（不调接口）→ 开关与凭证 → 读文件（≤ 20 MB）→ 预处理 → 预算 → 请求 → sidecar；失败按类别映射 `errorCategory`，不留半成品 |
| 附件 | `allowed-extensions.ts`、`import.ts`、`read-file.ts`、`ipc-validation.ts` | `image` 分类（6 种扩展名，20 MB，不并入文本白名单）；介绍行"这是图片，需要内容时用 look_at_image 提问，不要用 read_file 读取"（不含技能触发词）；对话框"图片"分组；`read_file` 读图片时拒绝并指路。聊天卡片缩略图沿用 P5.3 的内联预览 |
| 技能 | `skills/image-qa/SKILL.md`、`doc-to-markdown` 1.3.0 | 没问不看、带着问题看、引用文件名、`?` 照实转告、图纸先 `read_text`；扫描 PDF 用户问内容时按页 `look_at_image` |
| 探针 | `scripts/vision-probe.ts`（`pnpm vision:probe`） | 每张图各调一次，打印尺寸、送出字节、公式估算 vs `prompt_tokens`、请求 ID、回答前 200 字；对 400 / 404 / 413 给出 §2.5 对应的判断提示 |
| 测试 | `src/vision/__tests__/`、`src/tools/vision/__tests__/`、`src/config/__tests__/vision-settings.test.ts`、`src/workspace/__tests__/image-attachments.test.ts` | 公式与缩放、参数校验、sidecar 往返与匹配、原样送 / BMP 转 PNG / 解码失败、请求体与鉴权头、4xx / 超时 / 取消 / 非 JSON / 空回答 / 网络错误、工具的缓存命中与 refresh、多图 sidecar、开关关闭与未配置不发请求、失败不留 sidecar、预算上限、设置的默认关 / 复用 / 独立 / 半填拒绝、附件分类与介绍行、`read_file` 拒绝图片。`pnpm test:p8` |

**停线条件核对**（§8）：开关关闭时工具在读文件之前就返回，图片不会发出；同图同问同模式第二次不调接口（测试断言请求数不变）；
缩放下限 3600 写死在契约里；`question` 为空直接拒绝；识别结果只落 sidecar 与工具输出，不写记忆；只有一个供应商；预算超过 10 次报错。

**待用户**（P8.0 出口与 P8.2 / P8.3 出口）：
1. 百炼控制台开通 `qwen3-vl-plus`；把设备照片、图纸页、截图各一张放进 `docs/p8-samples/`；
2. `.env` 里已有百炼 Key 与接入点的话直接 `pnpm vision:probe docs/p8-samples/*.jpg docs/p8-samples/*.png`，把请求 ID、token 误差、`enable_thinking` 是否被接受、大图上限记到这里；
3. 应用里：设置 → 语音 → 看图 打开开关；拖一张照片进聊天问"这是什么"，看回答与缩略图；同一问题再问一次，运行记录里应是 `cached: true`；
4. 对桌面那份 6 页扫描图纸，转 Markdown 后问"这个件什么材质、图号多少"，人工核对标题栏 5 个字段的准确率，据此决定要不要做 P8.4。
