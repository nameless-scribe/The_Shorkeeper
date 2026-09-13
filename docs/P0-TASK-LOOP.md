# P0 闭环骨架：运行记录、工具契约与完成证据

> 版本：0.3.0
> 日期：2026-09-13
> 对应蓝图：`docs/personal-assistant-growth-blueprint.html` 的 P0「闭环骨架」
> 固定验收入口：`pnpm test:p0`（逻辑与数据）/ `pnpm test:p0:ui`（真实 Electron 渲染）
> 当前状态：核心工程实现与自动化验收已完成；待一周真实使用验收

## 1. 本轮落地范围

蓝图 P0 列出的五项核心能力均已落地。TaskRun / Approval / Artifact 构成可靠执行底座，Goal / Commitment 与每日管家在后续实现中补齐；安全预览与运行历史界面也已完成。当前只剩真实使用验收，见第 5 节。

| 蓝图条目 | 状态 | 实现 |
|---|---|---|
| 新增 Goal、Commitment、TaskRun、Approval、Artifact | 已落地 | `0021_task_runs.sql`、`0022_goals_commitments.sql`、对应 repositories |
| 任务支持等待确认、失败恢复、重启续跑与完成验证 | 已落地；续跑采用事实恢复与用户确认，不自动重放 | `src/agent/run-record.ts`、`src/agent/run-recovery.ts`、`src/tools/evidence.ts` |
| 工具声明风险、幂等、预览、可撤销和完成证据 | 已落地；三个高价值写工具支持确认前 dry-run | `src/tools/contract.ts`、`src/tools/file/preview.ts`、各内置工具 `sideEffects` |
| 支持直接创建待办 | 已落地 | `create_user_task` 工具 |
| 打通每日简报到晚间复盘 | 已落地 | `src/tasks/daily-steward.ts`、`src/config/daily-steward.ts`、`skills/daily-steward/SKILL.md` |

## 2. 行为契约

### 2.1 运行记录（TaskRun）

- 每次 `runOrchestrator` 都在 `run_started` 后写入 `task_runs`，记录来源（`chat` / `scheduled` / `voice`）、触发引用（定时任务 id、通话 id）、模型和阶段。
- 每次工具调用写入 `task_run_steps`，含顺序、工具名、风险等级、幂等声明、结束状态与错误分类；成功产物写入 `artifacts`。
- 终态（`finished` / `cancelled` / `error`）只由 run 自身收口一次，并记录最终 assistant 消息 id；迟到事件不能改写终态。
- 记录失败不会影响 run：中途写入失败后记录器停止步骤/阶段写入，但终态仍会尝试写入一次，避免一条正常结束的 run 在下次启动被误判为中断。token 用量写入失败同样不会把成功的 run 标成错误。
- 只有 `evidence: 'artifact'` 的工具，其返回的 artifacts 才写入 `artifacts` 表；`read_file`、`read_xlsx` 把输入文件当附件返回，不算产物。
- 同一 run 内被合并的重复调用记为 `skipped`，不计入成功步骤，也不计入失败。

### 2.2 中断恢复

- 应用启动时（数据库就绪后、接受任何 run 之前）执行 `reconcileInterruptedRuns()`：所有非终态 run → `interrupted`（`process_exit`），运行中的步骤 → `interrupted`，pending 审批 → `interrupted / startup`。
- 同一会话的下一轮对话会在 system prompt 注入「上次运行中断」说明：开始时间、已确认成功的步骤、未完成的步骤、已生成的文件，并要求助理先说明再询问是否继续，不得把未确认步骤说成已完成。只有注入说明的那一轮成功产生回复后才标记 `acknowledged_at`；若那一轮失败，说明保留到下一轮，不会因为一次模型错误而丢失。
- 定时提醒的自然语言快捷路径绕过主循环，但同样把审批（含 run / 会话）和工具执行写入运行记录；快捷路径工具抛错会转为失败结果而不是异常。
- 说明只在用户主动的聊天轮次（`kind = chat`）注入；定时任务和语音 run 不会替用户消费它。成功收口时会把该会话所有未告知的中断记录一并标记，连续两次崩溃留下的更早记录不会再冒出来。
- 这是"重启续跑"的第一形态：续跑由下一轮对话在完整事实上下文中决定，而不是自动重放模型流。

### 2.3 审批记录（Approval）

- 每次进入确认的工具调用都写入 `approvals`：run、会话、工具、参数摘要（≤ 2000 字）、风险等级。
- 结论区分 `approved`、`denied`（用户拒绝；若确认流程本身出错则 `decided_by = error`）、`expired`（5 分钟超时）、`cancelled`（run 中止或聊天窗关闭）、`interrupted`（启动收口）。
- 用户确认的等待不计入 120 秒工具执行超时；超时计时从确认通过后开始。
- 数据库未就绪时确认流程照常工作，只是不留记录。

### 2.4 工具契约

- `ToolDefinition.sideEffects` 声明 `risk`、`idempotent`、`supportsPreview`、`reversible`、`evidence`；内置工具必须显式声明（`tool-contract.test.ts` 强制）。
- 一个工具多路复用多种动作时用 `describeCall(args)` 按本次参数覆盖契约（`bookkeeping` 的 list/summary 视为只读），避免只读动作被当成重复副作用合并后返回过期结果。
- MCP 工具按规范 annotations 推导：`readOnlyHint` → 只读；`idempotentHint: false` → 非幂等；未声明时视为中风险、不可撤销，但**不**启用重复调用合并（无法确认幂等性时误合并读操作比重复执行更危险）。
- `risk: 'high'` 的工具无论策略如何都必须确认；当前没有内置工具是高风险。
- 非幂等副作用工具在同一 run 内以完全相同参数再次调用会被合并：不重复执行，复用首次结果并在输出前标注。只有首次成功的调用才会被记为已执行；失败后的重试照常执行。
- `evidence: 'artifact'` 的工具（所有写工作区文件的工具）成功后由主循环读回校验产物：存在且大小一致。原子写入路径已在落盘后校验过 SHA-256，主循环不再重复哈希，避免大文件被拖进工具超时；`checkArtifactEvidence` 可按需开启摘要校验。校验失败时结果降级为 `internal_error` 失败。
- 产物 `WorkspaceAttachment` 新增可选 `sha256`，原子写入路径直接复用读回摘要。

### 2.5 直接创建待办

- `create_user_task(title, due_at?, module?, notes?, status?)` 直接写入 `user_tasks`，不依赖 Excel；输入校验失败不触库；新建状态只能是 `pending` / `in_progress`。
- 已加入核心工具集合（不受技能白名单限制）和 system prompt 工具说明。

### 2.6 目标、承诺与每日管家

- `goals`、`commitments`、`briefings` 及 `user_tasks.goal_id` 已由 `0022_goals_commitments.sql` 落库。
- 用户承诺与待办联动，助理承诺与提醒联动；待办完成、取消或重开时同步关联承诺并保留 run 证据。
- `build_daily_brief` 与 `build_evening_review` 聚合天气、待办、提醒、承诺、目标和当日运行产物；`briefings` 保证同一天同类简报不重复生成。
- 设置页可显式启用每日管家、配置早晚时间和弹窗；安静时段遵循主动性策略。
- 对话承诺提取只创建 `proposed` 候选，不自动变成待办；确认后才生效。完整设计与实现状态见 `docs/P0-DAILY-STEWARD-DESIGN.md`。

### 2.7 确认前预览（dry-run）

- `write_file`、`replace_text` 与 `update_xlsx_cells` 声明 `supportsPreview: true`。需要确认时，主循环先以 `ctx.preview = true` 执行，预览阶段不得产生文件产物。
- 文本写入展示修改前/修改后内容；Excel 更新展示工作表、单元格地址与新旧值。预览通过现有权限弹窗呈现，用户确认后才真正写入。
- 预览带目标文件 SHA-256/缺失状态版本。确认后执行时重新比对；文件在等待期间发生变化则拒绝写入，要求重新预览，避免把过期确认应用到新内容。
- 全文件系统模式按用户已选择的权限策略直接执行，不额外弹出预览确认；默认确认模式使用完整的“预览 → 确认 → 版本复核 → 原子写入 → 产物校验”链路。

### 2.8 运行历史界面

- 设置 → 数据与任务 → 运行记录展示最近 100 条跨重启保存的 run，可按全部、正在运行、已完成、失败或中断筛选。
- 详情页展示阶段、耗时、模型、工具步骤、风险与错误类别、审批结论及文件产物；文件产物复用现有附件卡片打开。
- 列表读取 `agent:runHistory`，详情读取 `agent:runDetail`；`run_finished` / `run_error` 到达时自动刷新。页面只展示持久化的脱敏摘要，不暴露完整工具输出。

## 3. 查询入口

- IPC `agent:runHistory({ sessionId?, limit? })` 返回持久化的 run 列表。
- IPC `agent:runDetail(runId)` 返回 run、步骤、产物和审批记录。
- 与内存诊断 `agent:diagnostics` 的区别：内存诊断保留完整 telemetry 但重启即失；运行记录跨重启保留，只存脱敏摘要。

## 4. 验收

`pnpm test:p0` 覆盖：

- 仓库层（sql.js 与 better-sqlite3 双引擎）：步骤序号、终态单次收口、启动收口、审批单次决定、参数摘要上限。
- 记录器：完整生命周期写入、重放调用不重复产物、持久化失败降级不抛出。
- 中断恢复：说明文案不虚报完成、只注入一次、跨会话隔离、数据库未就绪时静默。
- 审批：用户/超时/中止/窗口关闭四种结论、确认器抛错时的记录、高风险强制确认。
- 主循环：非幂等重复调用合并、幂等与只读不合并、失败后重试不被合并、无产物的"成功"降级、确认上下文携带 run/会话/风险。
- 工具契约：全部内置工具显式声明、声明与权限一致、产物证据工具清单固定。
- `create_user_task`：创建、校验、契约声明。
- Orchestrator：运行记录从开始到终态、记录不可用时 run 照常完成、用量写入失败不影响 run、中断说明只在成功收口后确认。
- 提醒快捷路径：审批携带 run / 会话上下文、工具执行进入记录钩子、工具抛错转为失败结果。
- Goal / Commitment：双引擎 CRUD、状态推进、待办与提醒联动、完成证据。
- 每日管家：早晚聚合、同日幂等、设置同步、安静时段、提醒弹窗和承诺候选提取。

全量 Vitest、`pnpm typecheck`、`pnpm build`、`pnpm test:p0:ui` 与 `git diff --check` 作为收口条件。UI 冒烟会在隔离的 mock IPC 数据下打开真实 Electron renderer，并验证运行列表、详情、文本预览与 Excel 单元格预览；截图写入系统临时目录，不污染仓库或真实数据库。

## 5. 待验收

1. **真实使用一周（P0 最终产品验收）**：开启每日管家，记录简报是否准确、是否打扰、是否漏掉承诺，以及重启、中断、安静时段和同日幂等在真实环境中的表现。工程实现和自动化验收已经完成，但在这一步结束前不宣称产品效果已经稳定。
2. **真实交互覆盖**：重点观察预览内容是否足以判断改动、长文本与大量单元格是否易读、历史筛选是否符合用户直觉，以及过期预览被拒绝后的提示是否清楚。

已完成但曾列为后续项：确认前 dry-run、运行历史列表/详情界面、真实库首次启动迁移。2026-09-13 native 数据库已有 22/22 migrations，健康检查为 `healthy`，迁移前备份已创建。
