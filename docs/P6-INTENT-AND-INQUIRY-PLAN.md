# P6 · 意图理解与追问实施计划

> 计划验收入口：逐阶段补齐 `pnpm test:p6`
>
> 阶段编号沿用 P 系列。P6 回答的是用户的这句话："让它有自己的思想，懂得思考，理解我的想法，
> 证据不足时能向我发问收集信息。" 本文把这句话拆成可验收的机制，而不是换一个"更会想"的模型。

当前状态（2026-09-15）：**P6.0 至 P6.3 已实现并通过自动化回归**（提示词规则；`ask_user` 工具、主进程通道、提问弹窗、
运行阶段与计划项标记；`user_questions` 落库与中断恢复；会议纪要与每日管家改用 `ask_user`）。P6.4 的自动化回归已跑，
真实使用观察与 P6.0 的 5 条固定样本待用户执行。实施记录见第 10 节。

---

## 1. 目标与边界

**要解决的**：助理在**动手之前**能判断"我知道的够不够"，不够就问一个准确的问题，等到答案再继续；
问过的、用户说过的，下次不再问。

**拆成三件事**，每件都有落点：

| 用户的话 | 机制 | 性质 |
|---|---|---|
| 知道我想干什么 | 每轮已注入的个人记忆、目标、承诺、知识库；补一条"先查记忆再开口问"的规则 | 巩固 |
| 懂得思考 | 已有的执行计划工具与多步执行技能；补"计划里标出待确认点" | 巩固 |
| 证据不足时发问 | **新增 `ask_user` 工具**：暂停运行、弹出问题与选项、答案落库、重启后不丢 | 小扩展 |

**不解决的**：训练私有模型、换"会自己想事情"的模型、让助理在没人回答时自行决定高风险动作。见第 7 节。

**蓝图约束**：北极星是"了解你的目标和习惯、安全推进、失败可恢复、有证据"。
"思想"来自记忆、循环与追问三者的组合，这条计划不越过"不训练私有模型"的红线。

---

## 2. 现状与缺口（2026-09-14 摸查）

已经有的：

- **阻塞等待用户的完整链路**：`setPermissionConfirmer` 注入 → `requestPermissionConfirm` 建 `pending` 表、
  5 分钟超时、abort 与窗口关闭监听 → IPC `permission:request` / `permission:respond` →
  渲染层 `permission-queue`（一次只弹一个、重试安全）→ `PermissionDialog`。
- **落库与恢复**：`approvals` 表记每次确认；运行阶段 `waiting_approval`；应用退出时启动收口把
  `pending` 改为 `interrupted`，下一轮对话注入【上次运行中断】说明。
- **计划**：`update_agent_plan` 工具 + `AgentPlanPanel`，状态 `pending / in_progress / completed / cancelled`。
- **上下文**：每轮注入个人资料摘要、长期记忆前 5 条、活跃目标前 5 条、未完成承诺前 5 条、世界书、RAG。
- **稳定提示词**里已有"禁止猜测子目录""不得口头声称已完成""必须引用真实错误"。

缺的：

1. 提示词里**没有"证据不足先问"这条规则**。最接近的只有 organize 模式的"写入前先确认范围"。
2. 确认弹窗是二元的（允许 / 拒绝），载荷没有 `question` / `options` 字段。
3. `approvals` 只存截断后的参数摘要，**用户的回答没地方存**。
4. 退出时等待中的问题只变成一条"上次中断"的文字说明，**问题本身没有带到下一轮**。
5. 计划项没有"卡在等用户"的状态。
6. 全局只有一个模型档案，没有按用途路由。当前对话模型为 `qwen3.6-plus`。

---

## 3. 设计决定

### 3.1 什么时候该问，什么时候不该问

写进稳定提示词的规则（【证据不足先问】）：

- **该问**：歧义会改变产物或副作用时。典型：目标文件不唯一；"上个月"按哪个日期字段；
  收件人是谁；待办归谁；纪要大纲要不要这几节；查询口径（含税 / 不含税）。
- **不该问**：歧义不影响结果，或用一句声明的假设就能推进时。此时**先做，并在回复里写明假设**。
- **问之前先查**：`recall_memory` 与当前上下文里的目标、承诺、资料能回答的，不问。
  问了用户的，答案要作为记忆候选进入现有的记忆确认流程，下次不再问。
- **一次只问一个问题**，带 2–4 个选项加"其他"，问题里说明为什么需要这个信息。
- **高风险动作永远走权限确认**，`ask_user` 不能替代它。

### 3.2 `ask_user` 工具

- 参数：`question`（≤ 300 字）、`options?[]`（2–6 项，每项 `{ id, label, hint? }`）、`allow_free_text?`（默认 true）、`why?`（一句话说明用途）。
- 返回：`{ answer: string, optionId?: string, decidedBy: 'user' | 'timeout' | 'abort' | 'window_closed' }`。
  超时或取消时工具返回**失败**，模型必须停下并说明"这一步需要你的回答"，不得自行假设。
- 契约：`risk: 'read'`、幂等、无副作用、`evidence: 'output'`。它不写任何领域数据。
- 主进程：新增 `setUserQuestionResponder` 注入点与 `ask:request` / `ask:respond` 通道，
  实现**镜像** `permission.ts`（pending 表、超时、abort、窗口关闭）。超时 10 分钟，比权限确认长，
  因为回答问题可能需要用户去查资料。
- 渲染层：把 `permission-queue` 泛化为"提示队列"，条目 `kind: 'permission' | 'question'`，
  同一队列保证一次只弹一个；`QuestionDialog` 复用 `PermissionDialog` 的门户与键盘约定，
  选项是按钮，自由文本是输入框，Esc 等于"稍后再答"（工具返回 abort）。
- 运行阶段：`TaskRunPhase` 新增 `waiting_user`，运行记录页显示"等待回答"，不与 `waiting_approval` 混用。

### 3.3 持久化：`user_questions` 表

新增 migration，一张表：

| 列 | 说明 |
|---|---|
| `id` | uuid |
| `run_id` / `session_id` | 归属 |
| `question` / `why` | 原文 |
| `options_json` | 选项数组 |
| `answer` / `option_id` | 用户的回答，可空 |
| `status` | `pending / answered / expired / cancelled / interrupted` |
| `decided_by` | `user / timeout / abort / window_closed / startup` |
| `asked_at` / `answered_at` | |

不复用 `approvals`：它的语义是"允许不允许"，参数只存摘要，塞进回答会让两种记录互相污染。

### 3.4 退出时正在等回答

- 启动收口：`pending` → `interrupted`，与 approvals 一致。
- **问题随中断说明一起带到下一轮**：【上次运行中断】里附上"当时在等你回答：<问题>"，
  用户在下一轮直接回答即可，模型以新一轮运行继续。不做"原运行从断点恢复"——
  运行内存态（计划、工具中间结果）已经没了，假装恢复只会制造不一致。

### 3.5 计划里的待确认点

`AgentPlanItemStatus` 新增 `waiting_user`。`ask_user` 被调用时，若当前有 `in_progress` 的计划项，
自动把它标为 `waiting_user`；得到回答后改回 `in_progress`。面板上用 `?` 图标显示。
计划仍不持久化，与现状一致。

### 3.6 模型：先不路由

先用现有 `qwen3.6-plus` 跑 P6.4 的真实任务。只有当"该问不问、不该问乱问"的比例在真实任务里
明显偏高、且提示词调整无效时，才考虑为规划步骤引入第二个模型档案。**不预先做路由**。

---

## 4. 实施阶段

### P6.0 — 提示词规则与记忆先行（1 天）

- 稳定提示词加【证据不足先问】（3.1）。
- 现有 `context-builder-skills` 与 `stable-context` 测试补断言：规则块存在、措辞固定。
- 建立 `pnpm test:p6`。

**阶段出口**：不新增任何工具，模型在歧义场景会用对话提问并停下；无歧义场景不多问。
用 5 条固定对话样本人工验收。

### P6.1 — `ask_user` 工具与弹窗（3–4 天）

- 主进程注入点、IPC 通道、pending 表与超时（3.2）。
- 渲染层提示队列泛化、`QuestionDialog`。
- 循环层：调用 `ask_user` 时进入 `waiting_user`，计划项标记（3.5）。
- 固定样本：用户选项回答、自由文本回答、超时、Esc、窗口关闭、运行被取消、
  同时排队的权限确认与问题按先后弹出、同一问题不被回答两次。

**阶段出口**：`ask_user` 在真实界面里弹出并阻塞，答案回到模型；超时与取消不产生假设。

### P6.2 — 落库与中断恢复（1–2 天）

- `user_questions` 表与仓储（3.3）。
- 启动收口与中断说明带问题（3.4）。
- 固定样本：等待中退出 → 重启后记录为 `interrupted` 且下一轮说明里含问题原文；
  正常回答后 `answered` 且带 `option_id`。

**阶段出口**：应用退出后没有永远 `pending` 的问题；下一轮能接着答。

### P6.3 — 与已有技能接线（1 天）

- `meeting-notes` 的"哪位说话人是你 / 哪些待办要记"改用 `ask_user`。
- P5 的 `doc-compose` 的大纲确认改用 `ask_user`。
- `daily-steward` 的"待确认承诺逐条问"改用 `ask_user`（选项：加入待办 / 忽略 / 稍后）。
- 技能说明里删除"在对话里问"的措辞，统一为"用 `ask_user` 问"。

**阶段出口**：三个技能在真实使用中通过弹窗而不是长段文字提问。

### P6.4 — 回归与真实使用（2 天 + 观察）

- `pnpm test:p6`、全量、`typecheck`、`build`、`test:ui:strict`（新弹窗必须过严格模式）、`test:electron`。
- 真实使用记录：连续两周记下每次"该问没问"与"不该问却问"的例子，攒到 20 条再判断 3.6。

---

## 5. 会影响哪些现有模块

- `src/agent/stable-context.ts`：新规则块。
- `src/tools/`：新增 `ask-user.ts`；`src/agent/loop.ts` 识别它并切换阶段。
- `src/agent/permissions.ts` 旁新增 `user-questions.ts`（注入点），`electron/ipc/ask.ts`（镜像 `permission.ts`）。
- `src/renderer/hooks/permission-queue.ts` → 泛化为提示队列；新增 `QuestionDialog.tsx`。
- `src/shared/types.ts`：`TaskRunPhase`、`AgentPlanItemStatus`、问题载荷与结果类型。
- `src/db/migrations/`：`user_questions`；`task-runs.ts` 的启动收口扩展。
- `src/agent/run-recovery.ts`：中断说明带问题。
- `skills/`：三个技能的说明更新。

---

## 6. 明确不做

- 不训练、不微调私有模型。
- 不为"思考"引入第二个模型或多智能体编排；3.6 说明了触发条件。
- 不做原运行的断点恢复；重启后是新一轮运行。
- 不让 `ask_user` 绕过权限确认：它只收集信息，不授权动作。
- 不做"多问题表单"：一次一个问题，避免模型把决策打包甩给用户。
- 不自动把用户的每个回答写成长期记忆；走现有的记忆候选确认。

---

## 7. 推荐开工顺序与停线条件

建议顺序：**P6.0 → P6.1 → P6.2 → P6.3 → P6.4**。P6.0 只改提示词、半天可见效果；
P6.1 是主体；P6.2 补落库；P6.3 让已有功能立刻受益。

与其它阶段的关系：P5 的 `doc-compose` 与 P7 的数据查询都依赖 `ask_user`，
因此 **P6.1 应在 P5.1 之前完成**，或 P5.1 先用对话确认、P6.3 时切换。

出现以下任一情况立即停止扩大范围：

- 超时或取消后模型自行假设了答案并继续；
- `ask_user` 被用来"确认是否执行高风险动作"，替代了权限确认；
- 同一运行里连续三次提问而没有任何推进；
- 提问的内容在当前上下文或记忆里已经有答案；
- 退出后留下永远 `pending` 的问题；
- 弹窗在严格模式下出现状态丢失或重复弹出；
- 为了让模型"更会问"开始堆叠提示词而不是调整规则本身。

---

## 8. 待确认

- **超时 10 分钟是否合适**：真实使用后按数据调。
- **计划项 `waiting_user` 是否需要持久化**：现在计划本身不持久化，先保持一致。
- **3.6 的触发阈值**：P6.4 攒够 20 条例子后定。

---

## 9. 落地细节（2026-09-14 复核）

### 9.1 稳定提示词的规则原文（P6.0）

`src/agent/stable-context.ts` 新增块，措辞固定，测试断言逐句存在：

```
【证据不足先问】动手前先判断信息够不够。歧义会改变产物或副作用时（目标文件不唯一、时间按哪个日期、
收件人是谁、待办归谁、口径含不含某项），先问一个问题再做；歧义不影响结果时，直接做，并在回复里写明你的假设。
问之前先用 recall_memory 与当前上下文里的目标、承诺、资料找答案，找得到的不问。一次只问一个问题，
给 2–4 个选项并说明为什么需要。用户回答里的稳定偏好，用 save_memory 记为候选。
高风险动作永远走权限确认，提问不能代替确认。
```

P6.1 之后在句首补一句："有 `ask_user` 工具时用它提问，不要在正文里问。"
（实际落地：这句放在**工具说明**的【提问】块里，只在 `ask_user` 可用时出现——稳定前缀不提工具名，
语音通话运行不注册该工具时也就不会出现这句。见 §10.2。）

### 9.2 `ask_user` 工具（P6.1）

- 文件 `src/tools/interaction/ask-user.ts`。`category: 'skill'`，`requiresPermission: []`，
  契约 `{ risk: 'read', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' }`。加入 `agent-registry.ts` 的 `CORE_TOOL_NAMES`，不受技能白名单限制。
- 参数校验：`question` 1–300 字；`options` 0 或 2–6 项，每项 `{ id, label, hint? }`，`id` 唯一；`allow_free_text` 默认 true；`why` ≤ 120 字。
- `execute` 调 `src/agent/user-questions.ts` 的 `requestUserAnswer(payload, { runId: ctx.runId, sessionId: ctx.sessionId, signal: ctx.signal })`；该模块暴露 `setUserQuestionResponder(fn)`，默认实现返回 `decidedBy: 'abort'`（无界面时不假装有答案）。
- 返回：成功时 `output` 为 `用户回答：<answer>`（选项则附 `optionId`），`metadata: { optionId, decidedBy }`；超时 / abort / 窗口关闭时 `success: false`，`error` 为"这一步需要你的回答（未收到）"，模型据规则停下。
- **语音通话运行不注册它**：`call-session.ts` 发起的运行传入排除列表，模型在通话里用语音提问。

### 9.3 主进程与渲染层（P6.1）

- `electron/ipc/ask.ts` 镜像 `permission.ts`：`pending` 表、`requestId`、超时 10 分钟、abort 与窗口关闭监听、`ask:request` 推送、`ask:respond` 处理、`cancelAllPendingQuestions()` 接入 `coordinateRuntimeShutdown`。`main.ts` 里 `setUserQuestionResponder(requestUserAnswerViaWindow)`。
- `src/shared/types.ts`：`UserQuestionRequestPayload { requestId, question, options, allowFreeText, why }`、`UserQuestionResponse { requestId, answer, optionId? }`；`ipc-validation.ts` 加 `parseUserQuestionResponse`。
- `preload.ts`：`ask: { onRequest, respond }`。
- 渲染层：`permission-queue.ts` 泛化为提示队列，条目 `{ kind: 'permission' | 'question', payload }`，reducer 不变；`usePromptRequests` 同时订阅两个通道；新增 `QuestionDialog.tsx`（选项按钮 + 可选输入框，Enter 提交、Esc 稍后再答），与 `PermissionDialog` 一起挂在 `ChatPage.tsx` 与 `CallStage.tsx`。
- 运行阶段：`TaskRunPhase` 加 `waiting_user`；`loop.ts` 在执行 `ask_user` 前后调用新钩子 `onQuestionStart / onQuestionEnd`，`RunRecorder` 记 `waiting_user`；`run-history-view.ts` 标签"等待回答"、颜色与 `waiting_approval` 同为 cyan。内存态 `RunLifecycle` 的阶段集合不动。
- 计划项：`AgentPlanItemStatus` 加 `waiting_user`；`loop.ts` 在 `onQuestionStart` 时把当前 `in_progress` 项改为 `waiting_user` 并广播 `plan_updated`，结束时改回；`AgentPlanPanel` 图标 `?`。

### 9.4 落库与恢复（P6.2）

- 迁移 `0028_user_questions.sql`（编号按实际开工顺序取下一个）；仓储 `src/db/repositories/user-questions.ts`：`createUserQuestion / answerUserQuestion / listUserQuestions`。
- `requestUserAnswer` 在有数据库时先 `createUserQuestion`（`pending`），回答后 `answerUserQuestion`；`markInterruptedRuns` 把 `pending` 改 `interrupted`、`decided_by = 'startup'`。
- `run-recovery.ts` 的 `formatInterruptedRunNotice` 附上该运行最后一条 `interrupted` 问题："当时在等你回答：<question>"。

### 9.5 测试入口

`pnpm test:p6`：`src/agent/__tests__/stable-context.test.ts`（规则原文）、`src/tools/__tests__/ask-user.test.ts`（参数校验、mock 响应器的四种结果）、`src/agent/__tests__/loop-question-phase.test.ts`（阶段切换、计划项标记）、`src/renderer/hooks/__tests__/prompt-queue.test.ts`（两种条目混排、一次一个）、`src/db/__tests__/user-questions.test.ts`（落库、启动收口）、`src/agent/__tests__/run-recovery.test.ts`（说明含问题）、`src/shared/__tests__/ipc-validation.test.ts`（新载荷）。弹窗本身在 `test:ui:strict` 的 P0 冒烟里加一个"弹出问题 → 选项回答"的截图步骤。

## 10. 实施记录

（按"症状 → 证据 → 根因 → 修法"逐节追加。）

### 10.1 P6.0 提示词规则（2026-09-15）

只改提示词，不加工具。

| 文件 | 说明 |
|---|---|
| `src/agent/stable-context.ts` | 导出 `EVIDENCE_FIRST_RULE_SENTENCES`（6 句，§9.1 原文）与 `EVIDENCE_FIRST_RULE`；块加在稳定前缀里【上下文优先级】之后 |
| `src/agent/__tests__/stable-context.test.ts` | 断言块的位置、6 句逐句存在、且 P6.1 之前不出现 `ask_user` |
| `src/agent/__tests__/context-builder-skills.test.ts` | 断言规则排在人设之后、技能与工具说明之前，每轮都在 |
| `package.json` | `pnpm test:p6`，后续阶段逐个加测试文件 |

一个放置决定：规则放在**稳定前缀**而不是工具说明里。工具说明按本轮可用工具组装，技能白名单可能把
`recall_memory` / `save_memory` 之外的工具都过滤掉，但"先判断信息够不够"这条与工具无关，任何一轮都该在；
稳定前缀又是 prompt cache 的命中区，多这一段不增加每轮成本。测试里那条"稳定前缀不含 create_scheduled_task"
仍然成立——规则只提到两个核心记忆工具，它们不受技能白名单限制。

验收：`pnpm typecheck`、`pnpm test:p6`、全量测试通过。**阶段出口的人工部分待用户执行**：
下面 5 条固定样本，在应用里各问一次，记录"问了 / 没问 / 假设写明了没有"：

| # | 样本 | 期望 |
|---|---|---|
| 1 | 工作区里有 `报价单-v1.xlsx` 与 `报价单-v2.xlsx`，说"把报价单的税率改成 13%" | 问改哪一份，给两个选项 |
| 2 | "把这段话整理成一份方案文档"（只给了一段话，没说格式） | 直接做，回复里写明"按 Word 生成、标题取第一句" 之类的假设，不问 |
| 3 | "上个月的会议纪要发给我"（工作区只有一份纪要） | 不问，直接给 |
| 4 | 之前已说过"待办默认归我自己"，再说"记一条待办：周五交报告" | 不问归谁，直接记 |
| 5 | "把这几个文件删掉"（指代不清） | 先问是哪几个；且删除仍走权限确认，不能用提问代替 |

两周内在真实使用里数"该问没问 / 不该问却问"的次数（§7 的度量），偏高再动措辞或考虑 §3.6 的模型路由。

### 10.2 P6.1 `ask_user` 工具与弹窗（2026-09-15）

按 §9.2、§9.3 落地，主进程一侧逐行镜像 `permission.ts`。

| 层 | 文件 | 说明 |
|---|---|---|
| 注入点 | `src/agent/user-questions.ts` | `setUserQuestionResponder` / `requestUserAnswer`；默认实现返回 `abort`，取消信号已触发时不打扰用户 |
| 工具 | `src/tools/interaction/ask-user.ts` | 参数校验为纯函数 `parseAskUserArgs`；成功返回"用户回答：…（选项 id）"；超时 / 取消 / 窗口关闭返回失败"这一步需要你的回答（未收到）"。加入 `CORE_TOOL_NAMES` |
| 主进程 | `electron/ipc/ask.ts` | pending 表、10 分钟超时、abort、窗口关闭、`ask:request` 推送、`ask:respond` 校验选项 id 与自由文本；`cancelAllPendingQuestions` 接入关机协调器与 `agent:abort` |
| 共享 | `src/shared/types.ts`、`ipc-validation.ts`、`preload.ts` | `UserQuestionRequestPayload` / `UserQuestionResponse`、`parseUserQuestionResponse`（选项、文本、稍后再答三选一，空回答拒收）、`window.shorekeeper.ask` |
| 渲染层 | `hooks/prompt-queue.ts`、`usePromptRequests.ts`、`components/QuestionDialog.tsx` | 权限与提问同一条队列，一次只弹一个；对话页与通话页都挂载；工作流条显示"等待回答" |
| 运行记录 | `run-record.ts`、`task-runs.ts`、`run-history-view.ts` | 阶段 `waiting_user`，标签"等待回答"，与 `waiting_approval` 同为 cyan、同属"进行中"筛选 |
| 计划项 | `plan-state.ts`、`loop.ts`、`AgentPlanPanel.tsx` | `markRunPlanWaitingUser`：提问期间 `in_progress → waiting_user`，回答后改回，两次都广播 `plan_updated`；图标 `?` |
| 提示词 | `stable-context.ts` | 【提问】块只在工具可用时进工具说明 |
| 语音 | `orchestrator.ts`、`call-session.ts` | 新增 `excludeTools` 运行选项，通话运行不注册 `ask_user` |

两处与计划原文不同，都写在代码注释里：

- **契约 `idempotent: true` 而不是 §9.2 写的 `false`**。`tool-contract.test.ts` 要求只读工具必须幂等，
  而"同一问题再问一次"确实不多做任何事，幂等成立；`risk: 'read'` 也意味着它不经过权限确认、不被当成副作用合并。
- **`usePermissionRequests` 直接改名为 `usePromptRequests`**，没有保留旧文件做转发：它只有两个调用点，
  留一层壳只会让"一次只弹一个"这条约束有第二个入口。

自动化：`ask-user.test.ts`（校验、四种结果、无界面 fail closed、已取消不打扰）、`loop-question-phase.test.ts`
（阶段钩子顺序、计划项标记与广播、取消时的停下）、`prompt-queue.test.ts`（两种请求混排、StrictMode 双调用回归）、
`agent-workflow` / `ipc-validation` / `run-record` / `run-history-view` / `shutdown-coordinator` 各补一例；
P0 UI 冒烟新增"弹出问题 → 点选项 → `ask:respond` 收到 optionId"一步并截图。

**待用户真机验收**：在应用里制造一次歧义（工作区放两份同名不同版本的文件再让它改），确认弹窗出现、选项可点、
Esc 后助理说明"这一步需要你的回答"而不是自己猜；运行记录页该次运行阶段显示过"等待回答"。

### 10.3 P6.2 落库与中断恢复（2026-09-15）

| 文件 | 说明 |
|---|---|
| `src/db/migrations/0028_user_questions.sql`、`schema.ts` | `user_questions` 表：问题、原因、选项 JSON、回答与选项 id、状态、决定方式、时间；两个索引（run、status） |
| `src/db/repositories/user-questions.ts` | `createUserQuestion` / `answerUserQuestion`（只收口 pending，重复结论不覆盖）/ `listUserQuestions` / `markInterruptedUserQuestions` / `findInterruptedQuestion`；问题 300 字、原因 120 字、回答 4000 字限长 |
| `src/agent/user-questions.ts` | `requestUserAnswer` 有数据库时先记 pending，结果落回；响应器抛错也收口。账本失败只告警，不阻断提问（与 `confirmPermission` 同一态度） |
| `src/db/repositories/task-runs.ts` | `markInterruptedRuns` 同一事务内把 pending 问题改为 `interrupted / startup`，摘要多一个 `questions` 计数 |
| `src/agent/run-recovery.ts` | 【上次运行中断】附"当时在等你回答：<问题>"，并提示"用户若在这一轮直接回答了，就按回答继续，不要再问一遍" |

没做"原运行从断点恢复"（§3.4）：运行内存态已经没了，假装恢复只会制造不一致；用户在下一轮直接回答，模型以新运行继续。

自动化：`user-questions.test.ts`（双适配器：创建 / 收口 / 不覆盖 / 限长 / 启动收口与取最后一条）、
`run-recovery.test.ts` 补"中断说明含问题"，`native-migration.test.ts` 迁移数 27 → 28。

### 10.4 P6.3 已有技能接线（2026-09-15）

- `meeting-notes` 1.1.0：录音日期、说话人对应、三步确认全部改为 `ask_user` 逐个问；待办逐条问，选项为
  "记为我的待办 / 记为我答应别人的承诺 / 不记"，不再把整张表一次性丢给用户点头。
- `daily-steward` 1.1.0：天气城市、待确认承诺（加入待办 / 忽略 / 稍后）、结尾调整、晚间待办处置（顺延 / 取消 / 继续）、
  missed 承诺（改期 / 取消 / 已经做了）全部改为 `ask_user`；顺延时二次问新日期。
- 两个技能都写明：`ask_user` 返回失败时该项保持原状并如实说明，不替用户决定。
- `doc-compose` 尚不存在（P5.1 的产物），届时直接按 `ask_user` 写，不需要再改一次。
- `ask_user` 是核心工具，不受技能白名单限制；写进 `allowedTools` 只是让意图可见，契约测试仍校验它存在。

### 10.5 P6.4 自动化回归（2026-09-15）

`pnpm typecheck`、`pnpm test:p6`（14 个文件 83 用例）、全量、`pnpm build`、`pnpm test:ui:strict`（P0 冒烟含提问弹窗一步，
三个冒烟 `rendererConsoleClean`）、`pnpm test:electron` 均通过。真实使用观察（两周、20 条"该问没问 / 不该问却问"）由用户进行。
