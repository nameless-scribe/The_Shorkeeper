# P1 落地计划：可追溯的个人模型

> 版本：1.0.0（P1.0—P1.5 工程闭环已落地）
> 日期：2026-09-13  
> 对应蓝图：`docs/personal-assistant-growth-blueprint.html` 的 P1「真正懂你」  
> 前置：P0 工程与自动化验收已完成；P0 一周真实使用验收与本计划可并行  
> 计划验收入口：`pnpm test:p1` / `pnpm test:p1:ui`

当前进度（2026-09-13）：P1.0—P1.5 的工程实现和自动化验收已完成。七类事实、冲突裁决、版本链、实际上下文来源账本、稳定引用与来源卡片、本地文档新鲜度和显式低频同步已贯通；连续一周真实使用属于上线后的观察窗口，必须积累真实样本后单独记录结论，不能由单次自动化冒充。

## 1. 目标与完成证据

P1 不以“保存更多记忆”为目标，而是把现有零散记忆升级为一个**有类型、有来源、有时效、能识别冲突且可解释使用原因**的个人模型。

最终完成证据：

1. 守岸人可以说明一次回答使用了哪条记忆、来自哪里、是否仍有效。
2. 用户表达与旧偏好冲突的新事实时，旧事实不会被静默覆盖；需要确认的内容进入冲突队列。
3. 过期、被替代、被拒绝和禁止提供给模型的记忆不会进入上下文。
4. 本地知识源发生变化或消失时，界面能显示“有更新 / 来源缺失 / 已过期”，不会继续把旧内容伪装成最新事实。
5. 现有长期记忆、候选记录、RAG 文档和 P0 Goal / Commitment 数据迁移后仍可读取，迁移失败时阻止在不确定 schema 上继续运行。

## 2. 当前基础与缺口

### 2.1 已有基础

- `long_term_memory` 已支持结构化 `memory_key`、重要度、来源会话、Embedding、文本/语义检索和人工编辑删除。
- `memory_candidates` 已支持置信度、三类候选、确认/拒绝和被拒事实防止自动恢复。
- 对话结束后已有单次模型提取，低置信与关系内容进入确认，高置信稳定偏好可以静默保存。
- RAG 已有导入生命周期、内容哈希去重、文档版本链、来源文件名、混合检索和提示词内 `<ref>` 引用。
- P0 已有 Goal、Commitment、TaskRun、Approval、Artifact，可复用为目标真源、运行审计和完成证据。

### 2.2 关键缺口

- 同一 `memory_key` 当前直接 upsert，更新会覆盖旧内容，无法解释“之前是什么、为什么变了”。
- 长期记忆没有事实类型、置信度、有效期、敏感级别、状态和替代关系；`importance` 不能代替置信度。
- 候选只有 `stable_preference / relationship / other`，尚未覆盖身份、偏好、关系、事件、目标、习惯和程序性偏好。
- 来源只到会话级，无法定位消息、文档、工具或用户手工编辑；一次 run 也没有记录实际采用了哪些上下文来源。
- RAG 能提示模型标文件名，但 renderer 没有稳定的引用对象和回链；本地源文件改变后不会主动标记旧索引过期。

## 3. 领域决策

### 3.1 七类个人信息

- `identity`：姓名、称呼、地区、语言等身份信息。
- `preference`：饮食、表达、工具、格式等偏好。
- `relationship`：人物关系和与助手的关系；默认必须确认。
- `event`：发生过或计划发生的事件；通常具有有效期。
- `goal`：目标上下文。已有 `goals` 表是唯一真源，个人模型只引用，不复制目标状态。
- `habit`：作息、周期习惯和稳定行为模式。
- `procedure`：用户希望助理“以后如何做事”的程序性偏好。

自由文本旧记忆兼容为 `other`，但新的自动提取不得继续产生含糊 `other`，无法分类时应拒绝或进入人工确认。

### 3.2 记忆状态

- `active`：允许参与检索和上下文组装。
- `disputed`：与新事实冲突，等待用户决定；默认不自动注入冲突双方。
- `superseded`：已被新事实替代，仅保留历史与审计。
- `expired`：超过有效期，不再自动使用，可以重新确认恢复。
- `rejected`：用户明确拒绝，不允许自动提取恢复同一事实。

删除继续沿用现有用户操作，但在确认删除前先留下拒绝事实；P1 不把所有用户删除强制改成软删除。

### 3.3 来源与敏感度

- 来源类型：`conversation`、`user_edit`、`document`、`tool`、`goal`、`commitment`。
- 每条事实至少保留来源类型和稳定引用；对话来源优先记录 session/message/run，文档来源记录 document/chunk，手工编辑记录为用户来源。
- 敏感级别：`normal`、`private`、`sensitive`；另设 `model_use_policy = allow / deny`，不能只打标签却仍然注入模型。`private` 必须确认后保存；`sensitive` 不得自动保存，手工保存时默认 `deny`，只有用户在设置中明确开启后才允许用于回答。凭据、验证码、API Key 等仍直接拒绝，不作为可确认记忆。
- 来源摘要设置长度上限，不复制整段聊天，不把敏感正文写入运行日志。

## 4. 实施阶段

### P1.0 — 契约与回归样本

**状态：已实现并自动化通过。** 固定样本位于 `src/memory/__tests__/fixtures/p1-personal-model.ts`，契约测试位于 `src/memory/__tests__/personal-model-contract.test.ts`，专项入口为 `pnpm test:p1`。

**目的**：先固定行为，不动生产数据。

实施内容：

- 建立 P1 固定样本：稳定事实、偏好变更、关系推断、短期事件、敏感内容、同义重复、真假冲突、来源删除和知识文件变更。
- 固化个人事实类型、状态机、敏感策略、默认有效期和冲突决策矩阵。
- 新建 `pnpm test:p1`，初期只运行现有记忆/RAG/P0 兼容测试，后续阶段逐步加入新测试。

阶段出口：样本和预期结论可审查；每种状态转换都有允许/拒绝定义；尚不改变现有运行行为。

### P1.1 — 数据模型与兼容迁移

**状态：已实现并自动化通过。** migration 已使用编号 `0023`；旧库升级、来源回填、active key 唯一与历史共存、来源级联删除均由临时库覆盖，并在 sql.js 与 better-sqlite3 上验证 Repository 合约。

**目的**：为来源、时效和替代关系提供可迁移的底座。

建议新增 migration `0023_personal_memory_model.sql`：

- 为 `long_term_memory` 增加 `memory_type`、`confidence`、`sensitivity`、`model_use_policy`、`status`、`valid_from`、`expires_at`、`superseded_by`、`updated_at`。
- 为 `memory_candidates` 增加对应类型/敏感/时效字段，以及 `conflicts_with_memory_id`、`proposed_action`。
- 新增 `memory_sources`，记录事实与 session/message/run/document/chunk/tool/goal/commitment 的来源关联。
- 在新 migration 中移除现有“所有非空 key 全表唯一”的索引，改为仅对 `status = active` 的非空 `memory_key` 生效的 partial unique index；这样一个 key 只有一个当前事实，同时允许 superseded 历史版本保留原 key。
- 旧数据回填为 `memory_type = other`、`status = active`、`sensitivity = normal`；`importance` 原样保留，不将它伪装成置信度。

配套改动：`src/db/schema.ts`、长期记忆与候选 Repository、共享类型、`docs/DATABASE.md`、双 adapter 临时库 migration 测试。

阶段出口：旧库升级前后条数与内容一致；22 → 23 migration 可重复判定；sql.js / better-sqlite3 合约一致；真实数据库不用于自动化测试。

### P1.2 — 冲突识别与确认闭环

**状态：已实现并自动化及真实 Electron 验收通过。** 同 key 的不同事实会进入候选，原事实转为 `disputed`；用户可保留、替代或并存。替代、来源写入和候选确认处于同一事务，手工编辑也保留历史版本。凭据类内容直接拒绝，敏感和过期事实不会进入模型检索。

**目的**：停止“同 key 新值直接覆盖旧值”。

实施内容：

- 将提取结果先标准化为七类事实，再进行完全重复、语义重复、补充信息和真实冲突判定。
- 非冲突的高置信普通事实可按策略保存；关系、敏感、低置信和冲突事实进入候选队列。
- 冲突候选提供三个明确动作：保留原事实、用新事实替代、两条并存；替代时在一个数据库事务内更新新旧状态和来源。
- 用户手工编辑长期记忆也走同一版本化服务，不再绕过冲突/来源审计。
- P0 Goal / Commitment 保持自己的真源；涉及目标和承诺的提取只建立引用，不重复创建领域对象。

界面：扩展现有记忆候选面板，展示“原事实 / 新事实 / 来源 / 置信度 / 有效期”，复用现有 Settings 组件和主题 token。

阶段出口：固定冲突样本均不会静默覆盖；重复确认、重启恢复和并发确认保持幂等；用户拒绝后同一事实不会再次自动出现。

### P1.3 — 检索、上下文与可解释引用

**状态：已实现并自动化及真实 Electron 验收通过。** migration `0024`、预算后来源记录、四因子记忆排序、稳定 `mem/doc/goal/commitment` 引用、回答来源卡片与运行详情回链均已接入；审计只保存限长摘要。

**目的**：只把当前可信事实提供给模型，并留下“用了什么”的证据。

建议新增 migration `0024_context_sources.sql`：

- 新增 `task_run_context_sources`，按 run 记录实际注入的 memory/document/goal/commitment 来源 ID、标签和脱敏摘要。
- 检索默认排除 `disputed / superseded / expired / rejected` 与 `model_use_policy = deny` 的事实。
- 排序由相关度、重要度、置信度、新鲜度共同决定，设置明确的数量和 Token 上限。
- `formatMemoriesForPrompt` 改为稳定引用标签，例如 `<memory ref="mem:…" type="preference" source="conversation">`。
- Agent 回答涉及个人事实或知识文档时使用引用标签；renderer 将引用渲染为可点击来源卡片，能够打开记忆详情、原会话或知识文档。
- 运行记录详情增加“使用的上下文”区域，但只保存脱敏摘要，不保存完整 prompt。

阶段出口：过期/冲突事实不进入 prompt；一次回答能从 run 详情追溯到采用的记忆或文档；上下文预算和隐私回归通过。

### P1.4 — 本地知识来源的新鲜度与同步

**状态：已实现并自动化及真实 Electron 验收通过。** migration `0025`、手工检查、显式自动同步、启动/唤醒低频调度、changed/missing 状态、重新定位与成功后版本切换均已接入；旧快照在失败时保持可用。

**目的**：先把本地知识库做成可判断新旧的来源；云盘、邮件等外部连接留给 P2。

建议新增 migration `0025_document_freshness.sql`：

- 为文档记录 `source_kind`、`source_modified_at`、`source_size`、`last_checked_at`、`freshness_status`、`stale_reason` 和同步策略。
- 默认只手工检查；用户显式开启本地同步后，在应用启动、唤醒或固定低频检查点比较 mtime/size/hash，不使用无界文件监听。
- 源文件变化时先标为 `changed`，旧版本仍可查但带过期提示；重建成功后再原子切换为新版本。
- 来源缺失时标为 `missing`，不删除已导入副本；用户可以重新定位来源或保留只读快照。
- 文档引用携带文档版本和检查时间，避免模型把历史版本表述成“当前最新”。

界面：在现有泰提斯终端文档卡片中增加来源、新鲜度、上次检查和“检查更新 / 同步此文档”动作。

阶段出口：文件未变化不重复索引；变化、删除、重建失败和应用重启均有可解释状态；任何失败不破坏上一可用版本。

### P1.5 — 总体验收与真实使用

**状态：工程验收已完成；真实使用观察窗口已具备开始条件。** `test:p1`、真实 Electron P1 UI smoke、跨里程碑与全量回归作为本次交付证据；一周观察结果必须在实际使用满周期后补录，当前不虚报为已发生。

**目的**：把数据库、Agent 与 UI 组成可长期使用的完整闭环。

自动化出口：

- `pnpm test:p1`：migration、Repository、分类、冲突、时效、敏感策略、检索过滤、上下文来源和知识新鲜度。
- `pnpm test:p1:ui`：真实 Electron renderer 下的记忆筛选、冲突确认、来源详情、过期状态、知识更新和运行引用。
- `pnpm test:p0`、`pnpm test:s2`、`pnpm test:s4`、`pnpm test:s5`、全量 `pnpm test`、`pnpm build`、`git diff --check`。
- 临时数据库做 migration/回滚/故障注入；不得访问真实用户数据库。

真实使用出口：连续一周记录错误引用、冲突漏报、过期事实误用、候选打扰率和引用是否有帮助。P1 只有在“她能解释用了哪条记忆，偏好变化后不再使用冲突旧事实”得到真实样本证据后才标记完成。

## 5. 文件级落点

- 数据：`src/db/migrations/0023_*`、`0024_*`、`0025_*`，`src/db/schema.ts`，`src/db/repositories/long-term-memory.ts`、`memory-candidates.ts`、`rag-documents.ts`。
- 领域：新增 `src/memory/model.ts`、`conflicts.ts`、`selection.ts`；扩展 `candidate-policy.ts`、`summarizer.ts`、`long-term.ts`。
- Agent：扩展 `src/agent/context-builder.ts`、`run-record.ts` 与运行详情类型，不另建第二套上下文系统。
- IPC：扩展现有 `electron/ipc/memory.ts`、`documents.ts`、`agent.ts` 和 `electron/preload.ts`；所有输入继续使用 `trustedIpcMain` 与运行时校验。
- UI：扩展 `MemoryCandidatesPanel`、`LongTermMemoryPanel`、`DocumentsPage`、`RunHistoryPage`，不新增平行设置中心。
- 测试：现有 memory/RAG/Agent 测试目录旁增加 P1 用例，并提供独立 Electron UI smoke。

## 6. 明确不做

- 不在 P1 接入邮箱、日历、联系人、云盘 OAuth；这些属于 P2。
- 不训练私人模型，不上云同步用户数据库，不引入 Graph RAG 或新的向量数据库。
- 不自动保存全部聊天，不保存密码、Token、验证码或密钥。
- 不让冲突事实靠模型自行选择，也不让“较新的事实”天然覆盖用户明确确认过的事实。
- 不把 Goal / Commitment 的状态复制进长期记忆形成双真源。

## 7. 推荐开工顺序

**P1 工程阶段已结束。** 后续进入 P2 前只剩非阻塞的一周真实使用观察：记录错误引用、冲突漏报、过期误用、候选打扰率与引用帮助度；发现问题按本契约回补 P1，不把观察窗口继续扩成新功能阶段。
