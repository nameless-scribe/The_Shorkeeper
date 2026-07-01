# The Shorekeeper 稳定性与质量修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 修复审计发现的 **高/中优先级缺陷**，提升对话稳定性、记忆/RAG 召回准确度、错误可见性与调度可靠性；安全加固与 DB 性能优化作为可选 Phase 按需实施。

**背景：** [2026-07-01-rag-optimization.md](./2026-06-29-m5-rag.md) 已解决 RAG P1–P6、P10–P11；本计划覆盖 **Agent 并发、记忆 embedding、错误路径、FTS 质量、调度、Presence** 等审计项，与 RAG 计划剩余项（P3/P7/P9/P12）合并编排。

**Architecture 原则：**
- 不改变「主进程持有智能、渲染进程只展示」分层
- Session run lock 的 key **必须**与 orchestrator 实际 `session.id` 一致
- 向后兼容：AgUiEvent 扩展 `sessionId` 为可选追加字段，旧 UI 仍可工作
- 每个 Phase 独立验收，附带 Vitest

**Tech Stack：** Electron IPC · sql.js · Vitest · 现有 AG-UI 事件流

**预计总工期：** 5–7 天（Phase S1–S4 约 4 天；S5–S6 可选 +2 天）

---

## 问题清单（审计汇总）

| # | 类别 | 严重度 | 问题 | 影响 |
|---|------|--------|------|------|
| F1 | Agent | 高 | Session 锁 key 与 orchestrator 实际 session 不一致 | 并发锁失效 |
| F2 | Agent | 高 | 运行中会话可被 delete/archive/switch | DB 写入失败 |
| F3–F5 | Agent | 高 | 错误静默、abort 竞态 | 双 run / 无反馈 |
| F6 | 调度 | 高 | Session 忙时 cron 仍 markTaskRun | 定时任务丢失 |
| F7–F8 | 记忆 | 高/中 | embedding  stale、context 无向量记忆 | 召回差 |
| F9–F11 | RAG | 中 | FTS 容错、chunkIndex、维度告警 | 检索质量 |
| F12–F14 | Agent | 中 | 后台竞态、Presence 单 run | 状态不准 |
| F15–F20 | 体验/安全 | 中/低 | ErrorBoundary、importPaths、路径、DB 写盘 | 见 Phase S5–S6 |

---

## Phase 划分

| Phase | 名称 | 解决 |
|-------|------|------|
| **S1** | Agent 并发与错误可见性 | F1–F5 |
| **S2** | 记忆与 Context 召回 | F7–F8 |
| **S3** | RAG 质量收尾 | F9–F11, P3/P7/P9/P12 |
| **S4** | 调度、Presence、后台任务 | F6, F12–F14 |
| **S5** | Renderer 与 IPC 体验（可选） | F15–F17 |
| **S6** | 配置与 DB 性能（可选） | F18–F20 |

---

## 建议实施顺序

**S1 → S2 → S4 → S3 → S5/S6 按需**

详细 Task 步骤见 Cursor Plan「稳定性质量修复计划」附件；实施时以代码与单测验收为准。
