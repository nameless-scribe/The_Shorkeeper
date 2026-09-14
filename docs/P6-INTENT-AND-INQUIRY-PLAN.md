# P6 · 意图理解与追问实施计划

> 计划验收入口：逐阶段补齐 `pnpm test:p6`
>
> 阶段编号沿用 P 系列。P6 回答的是用户的这句话："让它有自己的思想，懂得思考，理解我的想法，
> 证据不足时能向我发问收集信息。" 本文把这句话拆成可验收的机制，而不是换一个"更会想"的模型。

当前状态（2026-09-14）：**未开工**。本文是开工前的契约，不是验收记录。

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

（开工后按"症状 → 证据 → 根因 → 修法"逐节追加。）
