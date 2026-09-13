# The Shorekeeper 长稳与恢复压测基线

> 版本：0.1.0
> 日期：2026-09-13
> 命令：`pnpm stability:soak`

## 范围

该命令只使用系统临时目录中的独立 native SQLite 数据库，不读写用户的主数据库、工作区或外观资源。测试结束时删除自己创建的临时目录。

当前基线包含：

- 1000 轮会话创建、两条消息写入和会话删除。
- 1000 轮 Worldbook 创建和删除。
- 100 份文档、每份 10 个 chunk 的数据、FTS 和向量 BLOB 写入，交错删除一半文档。
- 写入已提交数据后调用 `process.exit(23)` 模拟无清理强制中断，再重开数据库验证 WAL 恢复。
- 关闭前后 `integrity_check`、WAL/SHM、RSS 回落和活动句柄数量。

## 2026-09-13 参考结果

```text
cycles=1000
documents=100
chunks=1000
elapsed=5669.6 ms
integrity=ok
crashRecovery=true
initialRss=70.49 MiB
peakRss=140.01 MiB
finalRss=114.80 MiB
retainedRss=44.30 MiB
activeHandleDelta=0
dbSize=0.55 MiB
sidecarsClean=true
```

## 通过阈值

- 正常关闭和强制中断恢复后 `integrity_check=ok`。
- 强制中断前已提交数据可见。
- 正常关闭后不留非空 WAL/SHM。
- 活动句柄增量不大于 0。
- 主动 GC 后 RSS 保留增长小于 64 MiB。

RSS 阈值是回归护栏，不是平台级性能保证。若 Node/Electron、native SQLite 或 CI 主机发生变化，应先比较趋势并记录新基线，不应直接放宽阈值。

## 运行时取消基线

`pnpm stability:runtime-soak` 在独立进程中同时建立 200 个 Agent 会话 run、500 个后台压缩/记忆工作和 500 个 RAG 操作，再通过生产退出协调器一次性取消并等待收敛。

2026-09-13 参考结果：

```text
sessionRuns=200
backgroundTasks=500
ragOperations=500
elapsed=20.3 ms
allIdle=true
activeSessionRuns=0
retainedRss=4.72 MiB
activeHandleDelta=0
databaseCloseCount=1
```
