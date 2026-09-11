# better-sqlite3 原生 SQLite PoC

> 日期：2026-09-11  
> 状态：正式 adapter、副本迁移、NSIS 生命周期和切换命令已完成，生产主库尚未切换

## 1. 结论

`better-sqlite3@13.0.3` 已确定为原生 SQLite 生产迁移目标。Node.js 22 与 Electron 44 内置的 Node.js 24 均能直接加载同一平台包；WAL、FTS5、trigram、Embedding BLOB、事务回滚、在线备份和现有 Repository 注入均通过。

正式 `BetterSqliteDatabase` adapter 已接入数据库抽象层，并与 sql.js 运行同一套 migration 和 Repository 合约测试。真实主库副本迁移、业务数据摘要、FTS 回填、原子回滚探针和打包后 native 加载均已通过。默认生产入口仍使用 `sql.js`，正式 adapter 也默认拒绝打开已有数据库；生产切换前还需完成隔离安装生命周期、显式切换命令和真实知识库负载测试。

## 2. 版本矩阵

- `better-sqlite3`：`13.0.3`，固定版本。
- Node.js CLI：`22.22.1`，ABI `127`，加载通过。
- Electron：`44.3.0`，Node.js `24.20.0`，ABI `149`，加载通过。
- better-sqlite3 内置 SQLite：`3.53.4`。
- 平台：Windows x64。

`better-sqlite3 13` 要求 Node.js 22 或更高，并在 npm 包内提供平台入口，不需要安装脚本下载 Electron ABI 专用资产，也不依赖本机 C++ 编译工具链。

## 3. 验证结果

- WAL 与事务回滚：通过。
- FTS5 与 trigram 中文子串检索：通过。
- `Uint8Array` 写入、`Buffer` 读回和 Embedding 反序列化：通过。
- `AppDatabase` 适配与用户画像 Repository 注入：通过。
- RAG Repository 的文档/chunk 事务写入、trigram FTS 检索、行回读和删除：通过。
- sql.js / better-sqlite3 双 adapter 的 schema、事务与 Repository 合约：通过。
- `better-sqlite3.backup()`：通过，`integrity_check = ok`。
- Electron 44 / ABI 149 使用同一平台包加载：通过。
- 本机最近一次 1000 条临时 chunk 事务写入约 8 ms，仅作为方向性数据。
- 真实主库副本迁移：通过；14 个业务表逐行摘要一致，3 个 FTS migration 补齐，10 条 Worldbook 建立索引，原子回滚探针通过。
- electron-builder：NSIS 与 `win-unpacked` 生成通过，`win32-x64.node` 位于 `app.asar.unpacked`。
- 打包后运行时：Electron 44.3.0 / Node 24.20.0 / ABI 149 从 `app.asar` 路径加载 better-sqlite3，WAL 与 trigram FTS 通过。
- NSIS 生命周期：隔离首次安装、同版本覆盖升级、静默卸载和外部数据库保留均通过；注册项、快捷方式和临时文件无残留。
- 引擎切换：原 sql.js 主库保持不动，native 副本和 `.engine.json` 标记切换/回滚命令已实现；临时数据库切换、启动选择和回滚通过。

## 4. 可复现入口

```powershell
pnpm db:poc:native
pnpm db:native rehearse
pnpm dist
pnpm test:packaged-native
pnpm test:nsis-lifecycle
```

`db:poc:native` 复用正式 native adapter，只在系统临时目录创建数据库，完成后自动清理。`db:native rehearse` 对当前主库做只读健康检查和 SHA-256 备份，在临时副本上迁移、核对业务表和 FTS、模拟原子回滚；不会替换生产主库。追加 `--keep` 可保留迁移副本。Electron 验证入口为 `scripts/native-sqlite-electron-poc.cjs`，双 adapter 合约测试位于 `src/db/__tests__/adapter-contract.test.ts`。

## 5. 尚未完成

- 真实主库尚未执行 `cutover --yes`；执行前仍需关闭应用并再次确认备份与健康状态。
- 尚未用真实大知识库测试启动、检索、checkpoint 和备份耗时。

## 6. 生产迁移门槛

1. 生产依赖、`files`、`asarUnpack`、打包后加载、隔离安装、升级覆盖和卸载保留外部数据均已通过。
2. 在真实数据库副本上完成升级、完整性校验、关键数据核对、原子切换和失败回滚演练。
3. 已增加明确的引擎选择与切换标记；待真实主库激活后验收禁止静默回退。
4. 用预期知识库规模进行持续写入、FTS、Embedding 和备份基准测试。

## 7. 参考

- Electron 44.3.0：https://releases.electronjs.org/release/v44.3.0
- Electron/Node ABI：https://github.com/electron/node-abi/blob/main/abi_registry.json
- better-sqlite3 发布：https://github.com/WiseLibs/better-sqlite3/releases
- electron-builder native 依赖：https://www.electron.build/docs/troubleshooting/
