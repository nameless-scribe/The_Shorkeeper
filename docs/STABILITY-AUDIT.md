# The Shorekeeper 稳定性审计

> 日期：2026-09-10（S0 基线）
> 状态：历史文档；S0-S5 已完成，框架稳定化已收口
> 范围：当时的构建基线、数据库可靠性和数据规模快照

本文记录 **S0 冻结时** 的审计结论，不是当前运行时说明。后续阶段已经改变其中几条判断：

- 生产数据库已切换到 `better-sqlite3`，活动库为 `shorekeeper.native.db`；原 `shorekeeper.db` 仅作 sql.js 回滚源。
- 下文“继续保留 sql.js / 尚不构成立即迁移理由”是 S0 当时的结论，已被 S1 生产切换取代。
- “下一步进入 S2”也已过时；S2-S5 均已落地。当前状态见 [STABILITY-PLAN.md](STABILITY-PLAN.md)。

## 1. 结论（S0 当时）

当时项目已经具备私人助理底座，代码基线和数据库主体均可正常工作。数据库完整性检查通过，当时主库约 396 KiB，Embedding 约 68 KiB，知识库尚未导入文档，因此 **S0 当时**没有必须立即迁移到原生 SQLite 的容量或性能证据。

当时数据库健康状态为 `WARNING`，不是损坏。警告来自旧 migration 账本和一份历史损坏库备份；已实现的迁移修复会在下一次正常启动或执行 `pnpm db:migrate` 时纠正旧 FTS 状态并先生成迁移前备份。

原生 SQLite 运行时 PoC 当时已通过。Electron 已从停止维护的 34.5.8 升级到 44.3.0。S1 之后生产入口改为 native SQLite，不再把 sql.js 当作默认主库。

## 2. 工程基线

- `pnpm typecheck`：通过。
- `pnpm test`：75 个测试文件、286 项测试通过。
- `pnpm build`：通过。
- 非阻断项：渲染端主 JavaScript chunk 约 1.14 MB，后续可做代码分包。

## 3. 数据库快照（S0 当时）

以下路径和规模是 2026-09-10 的 sql.js 主库快照，不是当前生产库。当前活动库为 `shorekeeper.native.db`。

检查命令：`pnpm db:health`

- 路径：`D:\SQLlite\shorekeeper.db`
- 文件大小：396.0 KiB
- SQLite 版本：3.49.1（sql.js 运行时）
- `PRAGMA integrity_check`：`ok`
- Embedding BLOB：68.0 KiB
- WAL：0 B
- SHM：0 B；原残留 SHM 已在恢复流程中改名保留为安全备份
- 最近可用备份：2026-09-10，396.0 KiB，已经完整性校验
- 历史损坏库备份：1 个

关键数据量：

- 会话：14
- 消息：221
- 长期记忆：22
- Worldbook：10
- Token 使用记录：317
- 定时任务：2
- 用户任务：6
- 会话摘要：3
- RAG 文档：0
- RAG chunks：0

## 4. 已确认风险

### P1：migration 账本失真

旧账本把 `0002_worldbook_fts5.sql`、`0010_rag_fts.sql`、`0014_rag_fts_trigram.sql` 记录为已应用，但实际没有对应 FTS 表。原因是当前 sql.js 不支持所需 FTS5 能力，旧迁移器却把失败记成成功。

处理状态：实现已修复。新账本区分 `applied`、`skipped`、`partial`，并校验 FTS 实际结构；真实数据库副本迁移演练通过，三条记录均被纠正为 `skipped`。

### 已处理：备份过期

审计时最近可用备份超过 30 天。现已创建新的手动备份，并实现独立于 migration 的备份生命周期命令。

处理状态：已完成。支持创建、列表、校验、保留清理和恢复；默认保留策略为最近 10 份，删除必须显式确认。真实数据库副本恢复演练通过，恢复后 SHA-256 与源备份一致，`integrity_check = ok`。

### 已处理：残留 SHM sidecar

数据目录存在 32 KiB 的 `shorekeeper.db-shm`，对应 WAL 为 0 B。当前没有发现未 checkpoint 数据，但这说明数据库曾被原生 SQLite WAL 模式打开。

处理状态：数据库恢复流程确认 WAL 为空后，将残留 SHM 改名为 `shorekeeper.db-shm.pre-restore-1789023775752.bak` 保留；当前 WAL 和 SHM 均为 0 B。以后仍不得在其他程序写库时直接删除 sidecar。

### P2：sql.js 长期扩展能力

S0 当时数据规模下，sql.js 的容量和启动成本不是阻断项。但它采用整库驻留内存和整库导出保存，未来大量文档 chunks、Embedding 和高频写入会放大内存与落盘成本。

处理状态：**已由 S1 收口**。生产运行时切换到 `better-sqlite3`，活动库为 `shorekeeper.native.db`；sql.js 仅保留为回滚源和双 adapter 测试。S0 原文“继续保留 sql.js、暂不迁移”不再适用。

### 已处理：Electron 34 已停止维护

旧 Electron `34.5.8` 内置 Node.js `20.19.1`，ABI `132`，已经停止维护。当前已升级到 Electron `44.3.0`，内置 Node.js `24.20.0`，ABI `149`。

处理状态：自动化部分已完成。Vite、electron-builder、语音库等其他顶层版本保持不变，生产构建、运行时 smoke、NSIS 打包、隔离启动和 native SQLite 加载均通过。麦克风与真实音频设备需要人工验收。

### P1：更新源版本元数据落后

Electron 44 的隔离打包启动日志显示，更新源返回的最新版本为 `1.0.0`，低于当前应用 `1.2.0`。`allowDowngrade = false` 阻止了错误降级，但发布端元数据与本地版本不一致。

处理状态：当前保护有效；下一次正式发布前必须更新远端 `latest.yml` 与安装包，避免用户长期收不到新版本。

## 5. 已落地保护

- 数据库导出采用同目录临时文件、`fsync` 和原子替换。
- migration 前自动创建主库快照。
- 每个 migration 的 SQL 和账本记录在同一事务中提交。
- migration 状态可区分成功、能力不支持和部分冲突；`partial` 会阻断启动。
- sql.js 写入同步确认落盘；持久化失败会抛错并从主库恢复内存状态。
- `pnpm db:health` 只读检查主库，不触发 migration 或保存。
- 数据库健康检查已有自动化测试，覆盖正常库、迁移异常和损坏文件。
- `pnpm db:backup` 提供备份创建、列表、校验、保留清理和恢复。
- 启动、手动备份和恢复都拒绝非空 WAL；恢复失败时回滚原主库。
- Agent 和工具层数据库访问已收口到设置模块与 Repository，并由边界测试持续约束。
- 会话删除、摘要更新和 RAG 批量写入使用真实数据库事务。
- 用户画像已迁入可注入 Repository，`AppDatabase` 已解除对 `SqliteDb` 具体类的类型绑定。
- 长期记忆已迁入可注入 Repository，覆盖文本检索、Embedding BLOB、upsert 和异步 re-embed；领域层不再直接执行 SQL。
- Worldbook 已迁入可注入 Repository，覆盖 CRUD、启用状态过滤、LIKE 检索和可选 FTS；领域层保留关键词解析与降级匹配。
- RAG 已迁入可注入 Repository，文档、chunks、Embedding BLOB 与 FTS 写入保持事务一致；领域层只保留检索策略、缓存和文件生命周期。
- 知识文件在 Embedding 或数据库插入失败时会等待清理；删除使用 `.trash` 隔离和数据库失败恢复协议。
- 边界测试已覆盖 Agent、记忆、RAG、渲染、调度和工具层，禁止重新直接导入全局数据库。
- 原生 SQLite PoC 已验证 Node/Electron 双 ABI、WAL、FTS5/trigram、Embedding BLOB、事务回滚、Repository 注入和在线备份。

## 6. 当时的下一步（均已完成或降级）

1. ~~进入 S2，审计 Agent run 生命周期、取消、超时和错误恢复。~~ **S2 已完成。**
2. 人工验收 Electron 44 的界面、麦克风、语音播放、托盘和自动更新。仍可作为使用走查，不阻断框架稳定化收口。
3. ~~后续补 `better-sqlite3` 生产包、完整双 adapter 合约与首次数据库迁移 PoC。~~ **S1 已完成生产切换。**

S0-S5 之后的状态、剩余 P2 和明确不做的 S6 见 [STABILITY-PLAN.md](STABILITY-PLAN.md)。
