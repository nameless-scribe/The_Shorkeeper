# better-sqlite3 原生 SQLite PoC

> 日期：2026-09-11  
> 状态：Node/Electron 运行时验证通过，生产数据层接入暂缓

## 1. 结论

`better-sqlite3@13.0.3` 可以作为后续原生 SQLite 路线。Node.js 22 与 Electron 44 内置的 Node.js 24 均能直接加载同一平台包；WAL、FTS5、trigram、Embedding BLOB、事务回滚、在线备份和现有 Repository 注入均通过。

PoC 没有接入业务主线，也没有读取或修改真实数据库。Electron 已升级到 44.3.0，现有 sql.js 主线的 NSIS 打包和隔离启动通过。当前继续使用 `sql.js`，因为主库仍小；生产迁移前还需验证 native 打包、旧数据库升级、失败回滚和真实知识库负载。

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
- `better-sqlite3.backup()`：通过，`integrity_check = ok`。
- Electron 44 / ABI 149 使用同一平台包加载：通过。
- 本机最近一次 1000 条临时 chunk 事务写入约 8 ms，仅作为方向性数据。

## 4. 可复现入口

```powershell
pnpm db:poc:native
```

命令只在系统临时目录创建数据库，完成后自动清理。Electron 验证入口为 `scripts/native-sqlite-electron-poc.cjs`。

## 5. 尚未完成

- `better-sqlite3` 尚未加入生产 `dependencies`。
- electron-builder 的 `files` 与 `asarUnpack` 尚未包含该 native 模块。
- 尚未验证 sql.js 数据库到 native adapter 的首次升级和失败回滚。
- 尚未用真实大知识库测试启动、检索、checkpoint 和备份耗时。

## 6. 生产迁移门槛

1. 将 native 模块移入生产依赖，配置 `files` 和 `asarUnpack`，完成干净机器安装包测试。
2. 为 sql.js 与 native adapter 建立相同的 migration 和 Repository 合约测试。
3. 在真实数据库副本上完成升级、完整性校验、备份恢复和失败回滚演练。
4. 用预期知识库规模进行持续写入、FTS、Embedding 和备份基准测试。

## 7. 参考

- Electron 44.3.0：https://releases.electronjs.org/release/v44.3.0
- Electron/Node ABI：https://github.com/electron/node-abi/blob/main/abi_registry.json
- better-sqlite3 发布：https://github.com/WiseLibs/better-sqlite3/releases
- electron-builder native 依赖：https://www.electron.build/docs/troubleshooting/
