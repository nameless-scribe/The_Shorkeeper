# P3 落地计划：本地主动服务

> 版本：1.0.0（P3.0–P3.5 工程已完成；两周真实使用观察未开始）
> 日期：2026-09-13
> 对应蓝图：`docs/personal-assistant-growth-blueprint.html` 的 P3「克制的主动性」
> 产品决策：P2 外部连接器已取消；P3 不读取邮箱、外部日历、联系人或云盘
> 前置：P0 / P1 工程闭环已完成；真实使用观察与本计划并行
> 预计周期：单人顺序推进约 3–5 周，之后进行连续两周真实使用观察
> 计划验收入口：逐阶段补齐 `pnpm test:p3` / `pnpm test:p3:ui`

当前进度（2026-09-13）：P3.0–P3.5 的工程与自动化验收均已完成：`0026_proactive_events.sql`、四个 Repository、`src/proactivity/*`（契约、采集器、策略、协调器、服务、收件箱）、`electron/proactivity/runtime.ts`、`electron/ipc/proactivity.ts`、聊天标题栏收件箱入口与 `ProactiveInboxPanel`、设置页预算 / 静音项、每日管家聚合，以及 `pnpm test:p3` / `pnpm test:p3:ui`。尚未完成的只有 P3.5 的连续两周真实使用观察；自动化通过不等同于真实体验证据。实施细节与验收记录见文末第 9 节。

## 1. P2 取消后，P3 改成什么

P3 保留“克制地主动帮助用户”这一目标，但从外部世界驱动改为**完全由本地可信状态驱动**：

- 用户待办临近或逾期。
- Goal 长时间没有推进，或关联待办全部阻塞。
- Commitment 临近截止、错过、等待确认或长期未跟进。
- TaskRun 失败、中断，或产生需要用户处理的结果。
- 定时任务失败、错过执行或持续异常。
- 本地知识文件 changed / missing / 同步失败。
- 记忆候选发生冲突、敏感确认或临近过期。

原 P3 中以下内容删除：外部消息事件、外部日历会前准备、邮箱承诺扫描，以及依赖外部连接器的实时推送。P3 不需要 OAuth、Token、安全凭据库、第三方限流或外部写操作。

阶段编号保留 P3，不把它重命名为 P2。这样历史 P0 / P1 文档、测试入口和讨论不会因为一次产品取舍整体改号；P2 在路线中明确记录为“已取消”。

## 2. 现有基础与真实缺口

### 2.1 已经存在，不重复实现

- `src/assistant/proactivity.ts` 已有主动行为开关、安静时段、重复提醒判断和 notify / suppress / defer 策略。
- `electron/scheduler/cron.ts` 已能推迟一次性提醒、抑制周期提醒、避免同一任务重入，并为提醒弹出窗口。
- P0 已有 Goal、Commitment、用户待办、早间简报、晚间复盘、briefing 幂等记录和完成证据。
- Commitment 已有 `due_at`、`last_followed_up_at`、missed 状态和与任务 / run / artifact 的关联。
- TaskRun 已记录 finished / cancelled / error / interrupted、错误摘要、工具步骤、审批和产物。
- P1 已有记忆冲突 / 时效、文档 changed / missing 和可追溯来源。
- 设置页已有主动提醒开关、安静时段和通知去重分钟数。

### 2.2 P3 真正要补的能力

- 主动性决策目前只保存在进程内最近 50 条，重启即丢，无法形成长期审计或两周指标。
- `lastReminderNotificationAt` 是进程内状态，应用重启后同一提醒可能再次弹出。
- 只有“已排期提醒”进入现有决策函数；承诺、运行失败、文档变化和记忆冲突没有统一事件入口。
- 目前只有弹窗或静默，没有“普通建议先进入收件箱”的中间层。
- 没有事件 resolved / snoozed / dismissed 状态，来源恢复后也不能自动关闭旧提醒。
- 没有记录用户是否打开、采纳、忽略或稍后处理，因此无法判断主动性是否有帮助。
- 每日管家和定时提醒各自决定如何通知，尚未汇入统一的持久路由与频率预算。

## 3. 核心架构决策

### 3.1 主动服务闭环

```text
本地状态变化 / 低频校对
          ↓
LocalEventCollector（只读扫描 + 幂等投影）
          ↓
proactive_events（持久事件账本）
          ↓
ProactivityPolicy（确定性规则，不由模型决定是否打扰）
          ↓
收件箱 / 延后 / 即时提醒 / 抑制
          ↓
打开 / 采纳 / 忽略 / 稍后 / 已解决反馈
```

- 领域数据仍是唯一真源；主动事件只是由当前状态投影出的待处理提示，不能反向成为 Goal、Commitment、TaskRun、文档或记忆的真源。
- 事件是否通知由确定性策略决定，LLM 最多在路由完成后润色展示文本，不能决定紧急度、跳过安静时段或执行写操作。
- 默认路由到主动收件箱；只有用户明确订阅的到点提醒、接近不可恢复截止的高紧急事件和需要立即处理的安全失败才可弹窗。
- 点击“处理”只是打开来源或启动普通对话；修改待办、承诺、文档或设置仍走现有工具与权限确认。

### 3.2 事件来源与稳定去重键

| 事件域 | 首批事件 | 稳定去重键示例 | 解除条件 |
|---|---|---|---|
| 待办 | 今日到期、逾期 | `task:<id>:due:<date>` | 完成、取消或改期 |
| 承诺 | 临期、missed、待确认 | `commitment:<id>:<state>:<window>` | 状态改变或用户处理 |
| 运行 | error、interrupted | `run:<id>:<phase>` | 用户确认、重跑成功或忽略 |
| 调度 | 错过、连续失败 | `schedule:<id>:failure:<window>` | 下次成功或用户停用 |
| 知识 | changed、missing、同步失败 | `doc:<id>:freshness:<version>` | 同步成功、重新定位或保留快照 |
| 记忆 | 冲突待定、敏感待确认、临期 | `memory:<id>:<state>` | 候选已裁决、拒绝或续期 |
| 目标 | 临近目标日、长期无进展 | `goal:<id>:stalled:<window>` | 有新进展、暂停或关闭 |

事件正文只保存用户可读、限长、脱敏摘要和稳定 `source_ref`，不复制完整 prompt、文档内容、聊天正文或敏感记忆。

### 3.3 采集方式

- 不要求每个 Repository 同时写两张表。现有模块只发送轻量 `localStateChanged(domain)` 信号，协调器合并短时间内的重复信号，再由 collector 查询真源并幂等 upsert 事件。
- 应用启动后延迟执行一次有界校对；唤醒、任务变化、run 终态、文档同步结果和记忆候选变化触发局部校对。
- 另设低频兜底扫描，避免进程崩溃或旧版本升级时漏事件；扫描有数量、时间和批次上限，不阻塞启动或聊天。
- 每次投影同时解决已不成立的旧事件，避免收件箱永久残留“已经修好”的问题。

### 3.4 路由与降噪

- `inbox`：默认渠道；普通逾期、文档变化、单次运行失败、待确认记忆进入这里。
- `notify`：用户明确订阅的到点提醒、即将错过的高优先级承诺，以及明确需要立即操作的本地故障。
- `defer`：安静时段内原本可通知的事件，延后到安静时段结束；收件箱记录可以先建立但不弹窗。
- `suppress`：重复、已解决、已忽略、频率预算用尽或全局主动性关闭。
- 去重不再只按“几分钟内同一任务”，而是使用稳定 dedupe key + source version + 已持久化 delivery 历史；重启不能清空去重事实。
- 设置全局每小时 / 每日即时通知上限。达到上限后紧急度不足的事件进入收件箱，不丢弃。
- 用户可单条稍后提醒、按事件域静音或关闭全部主动服务；关闭后仍可选择是否保留收件箱历史。

## 4. 建议数据模型

P2 没有产生 migration，因此若开工时最新仍为 `0025`，P3 从 `0026` 接续。

### `0026_proactive_events.sql`

- `proactive_events`：kind、source type / id / ref、dedupe key、标题、脱敏摘要、urgency、状态、due / occurred / expires / resolved / snoozed 时间和 source version。
- `proactivity_decisions`：event、policy、route、reason、规则版本、评估时间；替代当前仅进程内的最近 50 条数组。
- `proactivity_deliveries`：event、channel、delivery key、状态、计划 / 实际发送时间和错误分类；持久化跨重启去重。
- `proactivity_feedback`：opened / accepted / dismissed / snoozed / resolved、时间和可选有限枚举原因，不保存自由文本隐私内容。

关键约束：

- `dedupe_key + source_version` 唯一，重复扫描只更新同一事件。
- decision 和 delivery 使用独立 idempotency key，重复调度不能生成第二次弹窗。
- 删除或解决来源时事件转为 resolved，不级联删除历史决策；历史按保留策略清理。
- Repository、`src/db/schema.ts`、`docs/DATABASE.md` 与 sql.js / better-sqlite3 双 adapter 测试同步更新，自动化只用临时库。

## 5. 六个实施阶段

### P3.0 — 事件契约与固定样本（2–3 天）

**状态：已完成。** `src/proactivity/contract.ts` 固定了事件类型、紧急度、状态机、去重键、幂等键、路由矩阵与解除条件；`contract.test.ts` / `collector.test.ts` / `policy.test.ts` 覆盖跨重启、改期、承诺完成、连续失败、文档恢复、记忆裁决、安静时段与预算耗尽样本。

- 固定事件类型、urgency、状态机、dedupe key、解除条件和路由矩阵。
- 建立样本：同一提醒跨重启、任务改期、承诺完成、run 连续失败、文档恢复、记忆冲突解决、安静时段、通知预算耗尽。
- 建立 `pnpm test:p3`，纳入现有 proactivity、scheduler、P0、P1 和生命周期兼容测试。

阶段出口：每种事件何时创建、更新、解决、通知和抑制均有确定答案；不改变生产行为。

### P3.1 — 持久事件账本与本地采集器（4–6 天）

**状态：已完成。** migration `0026`、`proactive-events` / `proactivity-decisions` / `proactivity-deliveries` / `proactivity-feedback` 四个 Repository、`sources.ts` 有界快照、`collector.ts` 纯投影、`coordinator.ts` 合并信号 / 启动延迟 / 唤醒 / 兜底扫描 / 关闭取消、`signals.ts` 轻量状态变化信号（各领域 Repository 发出）。目标停滞已一并接入。

- 新增 `0026`、四个 Repository、共享类型和纯规则 collector。
- 先接待办、承诺、TaskRun、定时任务、文档新鲜度和记忆候选六类来源；目标停滞作为本阶段末的可选低优先级来源。
- 建立合并信号、启动后延迟校对、唤醒校对、低频兜底扫描和 shutdown 取消。
- 将当前内存 decision log 迁入持久层，同时保留测试辅助能力。

阶段出口：相同本地状态无论重复扫描、崩溃重启还是休眠恢复都只生成一条活动事件；来源解决后事件自动 resolved。

### P3.2 — 主动收件箱与来源回链（4–6 天）

**状态：已完成。** 标题栏 `◎` 入口带未读角标，`ProactiveInboxPanel` 与 `SessionHistoryPanel` 同形态；"需要处理 / 稍后 / 已处理"三段、处理 / 稍后（固定档位）/ 已完成 / 忽略 / 清除已处理；`proactivity:*` IPC 经 `trustedIpcMain` 与 unknown 校验，推送前经销毁安全发送。回链打开待办、定时任务、运行记录、泰提斯终端或记忆页签；`electron-p3-ui-smoke.cjs` 验证加载、空、错误、重复操作、最小窗口与替代主题。

- 在聊天标题栏增加带未读数的克制入口，打开与 `SessionHistoryPanel` 视觉一致的 `ProactiveInboxPanel`，不新建平行设置中心。
- 分为“需要处理 / 稍后 / 已处理”，支持打开来源、标记已读、忽略、稍后和批量处理已解决事件。
- 每条卡片明确显示“为什么出现、来源、发生时间、紧急度、是否被延后”，不显示内部规则或敏感正文。
- preload / IPC 全链路使用共享类型、`trustedIpcMain` 和 unknown 校验；事件推送前检查窗口生命周期。

阶段出口：加载、空、错误、重复操作、最小窗口和主题状态通过实际 Electron 检查；点击来源能回到待办、承诺、运行、文档或记忆详情。

### P3.3 — 统一路由、跨重启去重与频率预算（4–6 天）

**状态：已完成。** `policy.ts` 处理 inbox / notify / defer / suppress 并记录规则版本与原因；显式定时提醒与每日管家完成提示改用持久投递账本（`ledger.ts`）做跨重启去重；新增每小时 / 每日弹窗预算、事件域静音、snooze 与关闭后是否保留历史的设置；全局关闭时不投影、不弹窗，UI 文案说明显式定时任务仍按设置执行。

- 扩展 `ProactivityPolicy` 处理 inbox / notify / defer / suppress，并记录规则版本和原因。
- 将现有提醒弹窗、每日管家完成提示和新增本地事件统一接入 delivery ledger。
- 加入每小时 / 每日即时通知预算、事件域静音、snooze 和跨重启 delivery key。
- 全局关闭主动性时禁止新弹窗和后台 Agent 主动 run；已有显式定时任务如何处理必须在 UI 文案中说明。

阶段出口：重启、时钟跳变、跨午夜安静时段、重复 signal、同源状态更新和多事件风暴都不会重复轰炸；事件不会因被抑制而丢失。

### P3.4 — 本地纵向场景（4–6 天）

**状态：已完成。** 承诺守望（临期入箱、2 小时内高优先级弹窗、"处理"久未跟进事件只更新 `last_followed_up_at`）、失败恢复（error / interrupted 汇总，不自动重放）、知识守望（changed / missing / 检查或索引失败）、记忆守望（冲突、敏感、临期）均经统一路由并可由来源自动收口；早间简报聚合待处理主动提示，晚间复盘记录处理 / 忽略 / 延后计数。

- 承诺守望：临期进入收件箱，高优先级且即将到期才通知；处理后更新 `last_followed_up_at`，不自动顺延或完成。
- 失败恢复：run error / interrupted 汇总为一条可恢复事件，打开后展示真实成功步骤、失败步骤和产物，不自动重放副作用。
- 知识守望：changed / missing / sync failed 进入收件箱，打开现有泰提斯终端处理。
- 记忆守望：冲突、敏感和临期事实进入收件箱，打开现有候选 / 记忆面板裁决。
- 每日管家升级：早间简报聚合未处理高价值事件，晚间复盘记录已处理 / 延后事项；继续以 P0 真源为准。

阶段出口：四个场景均能从本地状态产生事件、经过统一路由、回到真实来源并在来源解决后自动收口。

### P3.5 — 全局回归与两周真实使用（3–5 天 + 观察）

**状态：自动化部分已完成；两周真实使用观察未开始。** `pnpm test:p3` 23 个文件 119 用例、`pnpm test` 全量、`pnpm typecheck`、`pnpm build`、`pnpm test:p3:ui` 与 Electron 生命周期 smoke 均通过；`proactivity:metrics` IPC 已提供两周指标（事件数、弹窗 / 入箱 / 延后 / 抑制、打开 / 采纳 / 忽略 / 延后、来源自动解决数）供观察期记录。

- `pnpm test:p3` 覆盖 migration、collector、投影幂等、路由、预算、snooze、反馈、生命周期和来源解决。
- `pnpm test:p3:ui` 在 Electron renderer 使用固定模拟数据验证收件箱各状态；明确不把模拟 UI 当两周真实体验证据。
- 运行 P0 / P1 / S2 / S3 / S4 / S5、全量 `pnpm test`、`pnpm build`、Electron 生命周期与打包 smoke。
- 连续两周记录：每日即时通知数、重复通知数、关键承诺漏报数、打开率、采纳率、忽略率、snooze 后再次打扰率和错误紧急度。

阶段出口：连续两周无重复轰炸，关键承诺没有漏跟进；所有“有帮助”的结论来自真实使用记录而非测试桩。

## 6. 会影响哪些现有模块

| 模块 | 影响 | 风险 | 控制方式 |
|---|---|---:|---|
| 数据库 | 新增事件、决策、投递和反馈账本 | 中高 | 单一增量 migration、双 adapter、限长脱敏字段、保留策略 |
| 调度器 | 现有提醒和每日管家改走统一 delivery | 高 | 先保持原行为做 shadow decision，再切换路由；跨重启幂等键 |
| P0 数据 | 待办、目标、承诺成为事件来源 | 中高 | collector 只读投影；处理动作继续走现有 Repository / 工具 |
| P1 数据 | 文档和记忆状态成为事件来源 | 中高 | 不复制正文；稳定 source_ref；来源恢复自动解决事件 |
| Agent / TaskRun | 失败和中断进入收件箱 | 中 | 不自动重放；只展示真实步骤与证据；恢复仍需用户确认 |
| UI | 标题栏增加收件箱与未读数 | 中 | 复用现有侧栏和 keeper token；最小窗口与多主题验收 |
| 通知体验 | 从单提醒去重升级为全局预算 | 高 | 默认 inbox；即时通知白名单；安静时段、域静音、snooze |
| 启动 / 退出 | 增加有界校对和事件推送 | 中 | 启动后延迟，不阻塞首窗；合并、取消、宽限期和失败隔离 |

结论：直接进入 P3 比 P2 风险低很多，不需要新增外部依赖或账号安全边界。主要风险变成“打扰过多”和“事件状态不一致”；这两项可以通过持久账本、确定性规则、默认收件箱、跨重启去重和来源自动解决来控制。

## 7. 明确不做

- 不实现邮箱、外部日历、联系人、外部任务、云盘连接或 OAuth。
- 不把 MCP / Web Search 返回内容当作后台主动事件来源。
- 不让模型自行决定紧急度、通知渠道、安静时段例外或频率预算。
- 不在用户确认前自动顺延待办、完成承诺、重跑失败工具、同步文档或裁决记忆冲突。
- 不为每个领域复制一套通知表；所有来源进入统一事件账本。
- 不用自动化测试冒充连续两周真实使用结果。

## 8. 推荐开工顺序与停线条件

下一步进入 P3.0 / P3.1：

1. 先固定事件样本、dedupe key 和解除条件。
2. 建立 migration 与 Repository，迁移内存 decision log。
3. 只接待办、承诺和 TaskRun 做最小闭环，证明跨重启不重复。
4. 再接文档、记忆和定时任务，最后做收件箱 UI 与统一弹窗路由。

出现以下任一情况立即停止扩大事件来源：同一状态跨重启产生重复通知；事件写入会改变领域真源；启动等待大范围扫描；收件箱保存敏感正文；被解决事件不能自动关闭；全局关闭后仍有主动弹窗；失败 run 被自动重放副作用。

## 9. 实施记录与验收（2026-09-13）

### 9.1 已落地的模块

| 层 | 文件 | 说明 |
|---|---|---|
| 数据库 | `src/db/migrations/0026_proactive_events.sql`、`src/db/schema.ts`、`src/db/repositories/proactive-events.ts` / `proactivity-decisions.ts` / `proactivity-deliveries.ts` / `proactivity-feedback.ts` | 四张账本表；`scheduled_tasks` 新增失败真源列；`markTaskFailure` / `markTaskRun` 维护 |
| 领域 | `src/proactivity/contract.ts`、`collector.ts`、`sources.ts`、`policy.ts`、`coordinator.ts`、`service.ts`、`inbox.ts`、`ledger.ts`、`signals.ts` | 纯逻辑，不依赖 Electron；各领域 Repository 只发 `notifyLocalStateChanged(domain)` |
| 主进程 | `electron/proactivity/runtime.ts`、`electron/ipc/proactivity.ts`、`electron/scheduler/cron.ts`、`electron/main.ts`、`electron/ipc/performance.ts` | 启动后延迟 8 秒首轮校对、信号合并 1.5 秒、每 30 分钟兜底、每分钟检查延后补发、唤醒后局部校对、关闭前先停协调器 |
| 渲染 | `src/renderer/components/ProactiveInboxPanel.tsx`、`TitleBar.tsx`、`ChatPage.tsx`、`InputBar.tsx`、`settings/PerformancePage.tsx`、`settings/SettingsDrawer.tsx` | 收件箱面板、未读角标、回链打开设置页签或预填聊天草稿、预算 / 静音 / 历史保留设置 |
| 每日管家 | `src/tasks/daily-steward.ts` | 早间简报新增"待处理的主动提示"，晚间复盘新增处理统计 |
| 设置 | `src/config/performance.ts` | `notifyHourlyLimit`（默认 3）、`notifyDailyLimit`（默认 12）、`mutedEventDomains`、`keepInboxHistoryWhenDisabled` |

### 9.2 路由与去重的确定性规则

- 默认全部进收件箱；只有 `commitment_due_soon`（2 小时内）、`commitment_missed`、`schedule_failed`（连续 3 次）且紧急度 high 才有弹窗资格。
- 弹窗前依次检查：同版本已弹过 → 抑制；投递账本内最近弹窗在去重窗口内 → 抑制；事件域静音 → 入箱；每小时 / 每日预算耗尽 → 入箱；安静时段 → 延后到时段结束再评估。
- 显式定时提醒继续按用户订阅规则弹窗，但"最近通知时间"和"本次投递"改为读写投递账本：一次性提醒以 `run_at` 为发生键，周期提醒以分钟为发生键，重启不会重复。
- 采集只在快照完整（未被 200 条上限截断）的域里自动解决旧事件，避免误关闭。

### 9.3 验收结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test:p3` | 23 个文件 / 120 用例通过（含 sql.js 与 better-sqlite3 双适配器、跨重启不重复弹窗、安静时段补发、预算与静音、snooze / 唤醒 / 忽略 / 完成、来源自动解决） |
| `pnpm test` | 全量通过（一次因并行构建导致的超时在单独重跑后通过） |
| `pnpm build` | 通过 |
| `pnpm test:p3:ui` | 通过：未读角标、三段列表、展开解释、处理回链到运行记录、稍后固定档位、忽略、清除已处理、推送刷新、替代主题、360×520 最小窗口无横向溢出、设置页静音保存 |
| `pnpm test:electron` | 运行时与窗口生命周期 smoke 通过 |
| 连续两周真实使用 | 未开始；观察时用 `proactivity:metrics` 记录每日弹窗数、重复数、漏报数、打开 / 采纳 / 忽略率 |

### 9.4 收口前全盘审查（2026-09-13）

对 P0 至 P3 的全部改动做了五个切片的缺陷审查（数据库层、Agent 运行时与工具契约、记忆模型与文档新鲜度、调度与主动服务、渲染层与 IPC 边界），确认属实并已修复的问题：

| 领域 | 修复 |
|---|---|
| 主动事件账本 | 被来源解决 / 过期 / 新版本收口的事件在同一条件再次出现时重新打开（此前会永久留在"已处理"）；用户忽略或标记完成的不会复活 |
| 主动服务 | 唤醒的稍后事件在路由前重读账本状态，避免为已解决事件弹窗；文档事件改用稳定发生时间且不过期，不再每轮刷新；投影循环批量落盘；触发原因按优先级合并；"已处理"按最近变化排序；忽略原因限定三个枚举 |
| 调度器 | 一次性提醒先生成正文再认领投递，认领超过 10 分钟未发送可重新认领，进程崩溃不会吞掉提醒；安静时段推迟的执行不再被 `reloadScheduler` 清掉（只在退出时清除，触发时以数据库当前任务为准）；以 `run_error` 结束的定时 Agent 运行记为失败而非成功 |
| 数据库 | sql.js 引擎在每次落盘后重新启用 `PRAGMA foreign_keys`（`export()` 会重开连接丢失该设置） |
| Agent / 工具 | 简报生成失败时记录 `failed` 并允许直接重试；`manage_commitments` 不能对 proposed / 终态承诺执行 update / complete，confirm 先校验再写入并同步已有待办的截止日期，`due_within_days` 保留默认状态过滤；`replace_text` 声明为非幂等；被裁剪段落的来源不再记为"已注入"；MCP `destructiveHint` 映射为高风险须确认；主循环校验产物 SHA-256；步骤审计使用按调用的契约 |
| 记忆 / 文档 | 重新定位的来源路径按导入规则规范化，且不覆盖 mtime/size 基线（同步后能正确替代旧版本）；`model_use_policy = deny` 的内容不再送远端 embedding（语义查重与用户编辑后的重嵌入）；提取提示词给出今天日期，换算为过去的承诺截止时间丢弃；目标候选选择"并存"时保留原事实；用户明确要求记住时允许重新提出曾被拒绝的事实 |
| 渲染层 | 设置页保存失败可见并夹紧数值范围；设置抽屉按回链页签渲染无闪帧；引用 / 上下文来源详情加载防串位；文档"重新定位"防重复；收件箱回链草稿不覆盖已输入；权限对话框长按 Enter 不再吞掉排队请求 |

审查确认存在但本轮未改动（记录为已知限制）：

- 快照文档（无本地来源）按标题版本链替代同名旧文档是既有设计（`importer.test.ts` 验证 v2）；对话归档若使用相同标题会替代前一份，需要时在归档标题中加入日期。
- 自动提取与用户裁决并发时理论上可能出现同一 key 的 active + disputed 两行（网络等待期间的竞态），发生后候选会反复报错，需要手动拒绝再重新提出。
- 升级前导入的本地文档首次检查没有 mtime/size 基线，只能采用当前状态作为基线；来源仅 touch 未改内容时会重新嵌入生成新版本；同步反复失败会累积 `index_failed` 记录。
- 待确认候选在等待期间若同 key 已有记忆，只会提示刷新，不会自动升级为冲突候选。

### 9.5 明确的取舍

- 事件正文只保留标题与两三句脱敏摘要；记忆类事件只显示记忆键，不显示候选内容。
- 文档"同步失败"没有独立真源状态，取 `index_failed` 或 `unknown + stale_reason` 投影。
- 一次性提醒"错过"事件只在应用未运行导致 `run_at` 超过 15 分钟仍未执行时出现；应用启动后调度器会立即补发，因此该事件通常很快由来源自动解决。
- `pnpm test:p3:ui` 使用固定模拟数据验证界面状态，不能替代两周真实体验。
