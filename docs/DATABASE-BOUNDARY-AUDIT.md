# 数据库访问边界审计

> 日期：2026-09-11
> 状态：数据库访问边界收口完成
> 目标：降低业务层对 sql.js 的直接耦合，为原生 SQLite PoC 提供真实迁移范围

## 1. 审计结论

数据库访问已经统一收口。会话、消息、长期记忆、Worldbook、RAG 和系统数据的 SQL 均集中在 `src/db`；Agent、工具、记忆和知识库领域层不再直接取得全局数据库实例或执行 SQL。

第一阶段已经移除 Agent 和工具层的直接数据库访问。高层代码现在通过设置模块或 Repository 获取数据，并新增静态边界测试，禁止 `src/agent`、`src/tools`、`src/renderer`、`src/scheduler` 重新直接导入 `getDatabase()`。

第二阶段已将用户画像迁入可注入 Repository，并把 `AppDatabase` 从 `SqliteDb` 类别名收窄为结构化同步接口。未来原生 adapter 只需实现 `prepare`、`exec`、`transaction` 和批处理契约，不需要继承 sql.js 类。

`better-sqlite3@13.0.3` PoC 已用该接口直接注入用户画像与 RAG Repository。`Uint8Array` 写入与原生 `Buffer` 读回、RAG trigram FTS 检索、chunk 回读和事务删除均已验证，原生 adapter 不需要改领域调用方。

生产数据库已完成从 sql.js 到 better-sqlite3 的切换。主线通过引擎标记选择 native adapter，Repository 边界确保切换不需要重写业务层；原 sql.js 主库保留为回滚源。

## 2. 第一阶段改动

- `agent/stable-context.ts`：人设读取改用 `db/app-settings.ts`。
- `memory/extraction-state.ts`：读写改用设置模块，并支持注入数据库实例。
- `memory/session-context.ts`：会话摘要 SQL 移至 `db/repositories/session-summaries.ts`。
- `tools/life/bookkeeping.ts`：记账 SQL 移至 `db/repositories/bookkeeping.ts`。
- `db/repositories/sessions.ts`：会话、消息、摘要和提取状态删除改为单一事务。
- `db/repositories/user-profile.ts`：用户画像 CRUD 迁入可注入 Repository，领域层只保留 prompt 格式化。
- `db/repositories/long-term-memory.ts`：长期记忆查询、文本检索、Embedding BLOB 和写入迁入可注入 Repository；领域层只保留去重、向量计算和 re-embed 调度。
- `db/repositories/worldbook.ts`：Worldbook CRUD、启用状态过滤、LIKE 检索和可选 FTS ID 检索迁入可注入 Repository；领域层只保留关键词解析和匹配回退。
- `db/repositories/rag-documents.ts`：文档元数据、chunks、Embedding BLOB、FTS 排名查询和索引重建集中管理；文档、chunks 与 FTS 写入组成单一事务。
- `rag/documents.ts`：只保留内容哈希、FTS 查询策略、内存降级检索、缓存失效和知识文件生命周期。
- `rag/text-import.ts`：Embedding 或数据库插入失败时会等待知识文件清理完成；清理本身失败会返回聚合错误。
- `db/index.ts`：新增结构化 `AppDatabase` 接口，解除 Repository 对 `SqliteDb` 具体类的类型绑定。
- 新增边界测试，约束高层模块不能直接依赖全局数据库。

## 3. 当前直接访问分布

`src/db` 之外的非测试 TypeScript 文件中，数据库 SQL 直接调用为 0，`getDatabase()` 导入为 0。静态边界测试覆盖 `agent`、`memory`、`rag`、`renderer`、`scheduler` 和 `tools`，防止后续重新穿透 Repository。

## 4. 迁移复杂度

### 低复杂度

设置、用户画像、MCP 配置、定时任务、Token 统计、用户任务、会话、消息、摘要和记账主要是普通 CRUD。现有 `AppDatabase` 的 `prepare().get/all/run()` 形式与 `better-sqlite3` 接近，迁移时主要处理参数和行类型。用户画像 Repository 已作为第一份可注入领域模板完成。

### 中复杂度

长期记忆与 Worldbook Repository 已完成。两者的文本检索、Embedding BLOB 和可选 FTS 能力均通过统一 `AppDatabase` 接口访问。

### 高复杂度

RAG Repository 已完成以下核心验收：

- `Uint8Array` 与原生 SQLite `Buffer` 的双向兼容。
- 文档、chunks 和 FTS 的事务一致性。
- FTS5 与 trigram tokenizer 的真实编译能力。
- 大批量插入时的事务性能。
- 缓存失效与数据库提交顺序。
- 导入在 Embedding 或数据库写入失败时清理知识文件。

删除已改为隔离区协议：先将原文件移入 `knowledge/.trash`，再提交数据库删除。数据库失败时恢复原文件；数据库成功后即使最终 unlink 失败，文件也只会保留在隔离区，不再伪装成有效知识文件。

### 运行时复杂度

`SqliteDb` 当前同时承担 sql.js API 适配、事务、整库导出和同步耐久性确认。落盘失败会从未变更的主库重建内存状态。迁移原生 SQLite 时，业务 Repository 可以保留，但 WAL、备份和写入策略仍需要由 native adapter 替换。

## 5. 原生 SQLite 迁移边界

原生 adapter 已接入主业务并完成真实生产切换；当前仍需用大知识库副本补足容量和长期运行基准：

1. `better-sqlite3` 在当前 Node/Electron 版本下安装、重建和加载。
2. electron-builder Windows 安装包能够携带并加载 native 模块。
3. 现有 0000-0015 migrations 能在数据库副本上完整执行。
4. `PRAGMA integrity_check`、WAL 和 SQLite backup API 可用。
5. FTS5 与 trigram tokenizer 可用；若不可用，明确降级策略。
6. Embedding BLOB 写入和读取与当前向量序列化格式一致。
7. 1、100、1000 个 chunks 的批量写入、启动时间和内存占用有基准结果。
8. Repository 测试可在 sql.js 与原生 adapter 上复用。

## 6. 决策门槛

满足以下任一条件时，原生 SQLite 迁移优先级提高：

- 知识库达到数千 chunks 后，整库导出明显影响响应或退出速度。
- 数据库进入数十 MiB，并出现持续内存增长。
- 高频写入或大型 Embedding 库导致 sql.js 同步整库导出成为可测量瓶颈。
- 需要可靠 FTS5、WAL、在线备份或更强并发访问。

当前主库约 396 KiB、RAG 文档为 0，暂时没有立即迁移的容量证据。推荐先完成 PoC 和接口验证，再决定是否替换主线。

## 7. 下一步

1. 进入 S2.3-S2.6，逐步收口运行时日志、错误分类、上下文预算和后台任务恢复。
2. 进入 S4 前使用真实大知识库副本验证 native SQLite 的持续写入、FTS、checkpoint、备份和恢复性能。
