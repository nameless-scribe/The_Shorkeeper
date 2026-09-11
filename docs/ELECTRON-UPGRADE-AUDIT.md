# Electron 升级审计

> 日期：2026-09-10  
> 状态：自动化升级与打包验证通过

## 1. 结论

项目已从 Electron `34.5.8` 升级到固定版本 `44.3.0`。本次只升级 Electron 和原生 SQLite PoC 依赖，没有同时升级 Vite、electron-builder、语音库或业务依赖，以控制回归范围。

生产构建、隐藏窗口运行时 smoke、NSIS 打包和 `win-unpacked` 隔离启动均通过。当前可以继续以 Electron 44 作为稳定化底座，但麦克风、扬声器、托盘交互和安装覆盖仍需人工验收。

## 2. 运行时矩阵

- 升级前：Electron `34.5.8`、Chrome `132.0.6834.210`、Node.js `20.19.1`、ABI `132`。
- 升级后：Electron `44.3.0`、Chrome `152.0.7977.78`、Node.js `24.20.0`、ABI `149`。
- 开发机 Node.js：`22.22.1`，满足 Electron npm 包要求的 Node.js `>=22.12.0`。
- electron-builder：`26.15.3`，保持不变。
- Vite：锁文件解析为 `6.4.3`，主版本保持不变。

## 3. 新增回归入口

```powershell
pnpm test:electron
```

该脚本不启动真实业务主进程，不读取用户数据库。它验证：

- sandbox preload 能加载并暴露 `window.shorekeeper`。
- renderer 保持 `contextIsolation = true`、`nodeIntegration = false`、`sandbox = true`。
- sql.js WASM 可初始化。
- `@napi-rs/canvas` 原生模块可加载并生成 PNG。
- WebAssembly 与 AudioContext 在 renderer 中可用。

## 4. 打包结果

- `pnpm dist`：通过。
- NSIS 安装包：`release/The Shorekeeper Setup 1.2.0.exe`。
- 安装包大小：`179,034,298` 字节。
- SHA-256：`1F0C0C52781D240CA6F07E987D5BAF65E75D3522520284113CC274534D334276`。
- `win-unpacked` 包含 sql.js、VAD、数据库 migration 和 Windows x64 canvas 原生文件。
- 隔离启动通过：数据库和工作区重定向到系统临时目录，migration、persona seed 和 scheduler 均完成，测试目录已清理。

### 隔离测试记录

打包应用测试必须在进程启动前同时覆盖 `SHOREKEEPER_DB_DIR`、`SHOREKEEPER_DB_PATH` 和 `SHOREKEEPER_WORKSPACE_DIR`。首次测试只覆盖了目录变量，项目 `.env` 中的完整数据库路径仍生效，应用因此对真实库执行了正常启动迁移并更新窗口状态。

启动前自动生成的迁移备份使这次操作可完整回退。发现后已通过项目恢复命令还原测试前数据库；当前主库与 `shorekeeper.db.pre-migration.bak-15608-1789021310307-1` 的 SHA-256 均为 `FB79365B76DACBB0769EB3039828FF12235DC49E689B67CCADE3A9315C85698A`，业务数据未保留测试改动。随后使用三个显式临时路径重新测试并通过。

## 5. 原生 SQLite 兼容性

`better-sqlite3` 已升级到固定版本 `13.0.3`。同一平台包可在 Node.js 22 ABI 127 与 Electron 44 ABI 149 下直接加载，FTS5 trigram 和 SQLite `3.53.4` 验证通过。该依赖仍是 dev-only PoC，没有进入生产数据层。

## 6. 剩余风险

- 需要人工测试主聊天窗、状态窗、日程窗、通话窗、托盘和多显示器行为。
- 需要使用真实麦克风与播放设备测试 VAD、STT、TTS 和通话中断。
- 尚未实际运行 NSIS 安装、旧版本覆盖安装和卸载保留数据测试。
- 更新源返回的最新版本仍为 `1.0.0`，低于当前 `1.2.0`；正式发布前必须更新远端版本元数据。
- renderer 主 chunk 约 1.14 MB，仍是非阻断性能优化项。
- package.json 缺少 `description` 和 `author`，electron-builder 会产生非阻断警告。

## 7. 参考

- Electron 44.3.0：https://releases.electronjs.org/release/v44.3.0
- Electron 支持时间线：https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- Electron 破坏性变更：https://www.electronjs.org/docs/latest/breaking-changes
