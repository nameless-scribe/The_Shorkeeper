# RAG 知识库优化与修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 在 **不更换 sql.js 栈** 的前提下，修复 M5 RAG 在检索质量、Token 成本、性能与文档生命周期上的已知缺陷，使知识库问答更准、更省、更可维护。

**背景：** M5 已完成朴素 RAG（见 [2026-06-29-m5-rag.md](./2026-06-29-m5-rag.md)）。M7-4 已做寒暄过滤与 `RAG_ENABLED` 开关，但仍有全量 DB 扫描、粗粒度分块、纯向量检索、自动注入过宽等问题。本文档为 **M5 后续专项**，可与 M7 其余 Task 并行或穿插实施。

**Architecture：** 继续采用 `embedding BLOB` + TypeScript 余弦相似度；在 `retriever.ts` 与 `documents.ts` 之间引入可失效的内存缓存；分块与检索策略分层扩展，不破坏现有 IPC / 设置页 / `search_knowledge` 工具接口。FTS5 混合检索复用 Worldbook 已有模式（`src/memory/worldbook.ts`）。

**Tech Stack：** sql.js · OpenAI-compatible Embeddings API · FTS5 · Vitest · Electron IPC

**预计总工期：** 4–6 天（分 4 个 Phase，可独立验收）

---

## 问题清单（现状审计）

| # | 类别 | 问题 | 影响 | 相关代码 |
|---|------|------|------|----------|
| P1 | 性能 | 每次检索 `loadAllChunkEmbeddings()` 全量读 DB + 线性扫描 | 延迟与内存随 chunk 数线性增长 | `documents.ts`, `retriever.ts` |
| P2 | 成本 | `shouldRunRag` 仅排除寒暄，有文档则几乎每轮 embedding + 注入 catalog + top-5 | Token / API 调用偏高 | `performance.ts`, `context-builder.ts` |
| P3 | 成本 | 自动注入与 `search_knowledge` 工具可能重复检索、重复片段 | context 冗余 | `context-builder.ts`, `knowledge-tools.ts` |
| P4 | 质量 | 512 字符硬切，无视 Markdown 结构 | 语义断裂、召回差 | `chunker.ts` |
| P5 | 质量 | 纯 dense retrieval，无 BM25/FTS | 专有名词、型号、错误码召回弱 | `retriever.ts` |
| P6 | 质量 | top-5 无按文档去重 / MMR | 多条来自同一长文档 | `vector.ts`, `retriever.ts` |
| P7 | 质量 | `MIN_SCORE=0.35` 硬编码，换模型后失效 | 误召回或零召回 | `retriever.ts` |
| P8 | 运维 | 无文档更新/re-index；重复导入无 hash 去重 | 知识库难维护 | `documents.ts`, `text-import.ts` |
| P9 | 运维 | embedding 维度变更时静默 score=0 | 换模型后检索失效无提示 | `vector.ts`, `embedding.ts` |
| P10 | 边界 | 对话归档写入 RAG 无与已有文档语义去重 | 知识库膨胀 | `conversation-knowledge.ts` |
| P11 | 能力 | 仅 MD/TXT；PDF/DOCX 未接入导入 | 用户需手动转换 | `importer.ts` |
| P12 | 设计 | `EmbeddingStore` 接口已定义未使用 | 抽象未完成 | `embedding-store.ts` |

---

## 关键约束（实施前必读）

| 项 | 决策 |
|----|------|
| 向量存储 | **维持** BLOB + JS top-K，Phase 4 才评估 sqlite-vec |
| 向后兼容 | 新 migration 仅 **追加** 列/表；旧 chunk 无 FTS 行时仍可纯向量检索 |
| 默认行为 | Phase 1 完成后默认 **收紧自动注入**；提供设置项回退到 M5 行为 |
| 规模假设 | 仍面向自用 <5000 chunks；缓存后全量扫描可接受，>10000 需 Phase 4 |
| 测试 | 每个 Phase 必须有 Vitest；Phase 2 起增加固定 fixture 文档回归 |

---

## Phase 划分

| Phase | 名称 | 工期 | 解决问题 | 验收要点 |
|-------|------|------|----------|----------|
| **R1** | 性能与成本快速修复 | 1 天 | P1, P2, P3, P6 | 检索不再每次读 DB；非知识问答不 auto-inject 片段 |
| **R2** | 分块与混合检索 | 1.5 天 | P4, P5, P7 | Markdown 结构化分块；FTS+向量融合；可调阈值 |
| **R3** | 文档生命周期与边界 | 1 天 | P8, P9, P10 | 重嵌入提示；导入去重；归档语义去重 |
| **R4** | 体验增强（可选） | 1.5 天 | P3, P11, P12 | Lazy RAG 模式；PDF/DOCX 导入；EmbeddingStore 落地 |

---

## 文件结构预览（变更后）

```
src/
├── db/
│   └── migrations/
│       └── 000X_rag_fts.sql              # R2: document_chunks FTS
│       └── 000Y_rag_metadata.sql         # R3: content_hash, embedding_model
├── rag/
│   ├── chunker.ts                        # R2: markdown-aware split
│   ├── chunk-cache.ts                    # R1: 内存缓存 + invalidate
│   ├── documents.ts                      # R1/R3: 缓存钩子、hash、re-embed
│   ├── retriever.ts                      # R1/R2: 混合检索、去重 top-K
│   ├── hybrid.ts                         # R2: RRF 融合
│   ├── embedding-store.ts                # R4: sql.js 实现
│   └── __tests__/
│       ├── chunker.test.ts
│       ├── retriever.test.ts             # 新增
│       └── hybrid.test.ts                # 新增
├── config/
│   └── performance.ts                    # R1/R4: ragInjectMode 设置
├── agent/
│   └── context-builder.ts                # R1: 按模式注入
└── renderer/settings/
    └── PerformancePage.tsx               # R1/R4: RAG 注入模式 UI
```

---

# Phase R1：性能与成本快速修复

**交付物：** chunk embedding 内存缓存；收紧自动 RAG 注入；检索结果按文档去重。

### Task R1-1：Chunk 缓存层

**Files:**
- Create: `src/rag/chunk-cache.ts`
- Modify: `src/rag/documents.ts`, `src/rag/retriever.ts`
- Create: `src/rag/__tests__/chunk-cache.test.ts`

- [ ] **Step 1:** 实现 `getCachedChunkEmbeddings()` / `invalidateChunkCache()`
  - 首次调用从 DB 加载并缓存 `{ id, documentId, chunkIndex, content, filename, embedding }[]`
  - `insertDocumentWithChunks`、`deleteDocument` 成功后调用 `invalidateChunkCache()`

- [ ] **Step 2:** `retriever.ts` 与 `loadAllChunkEmbeddings` 调用方改为走缓存

- [ ] **Step 3:** 单测：invalidate 后再次读取应重新加载（mock DB 或 spy）

**验收：** 同进程内连续两次 `retrieveRelevantChunks` 仅触发一次 DB 全量 SELECT（可通过 spy 验证）。

---

### Task R1-2：收紧 RAG 自动注入策略

**Files:**
- Modify: `src/config/performance.ts`
- Modify: `src/agent/context-builder.ts`
- Modify: `src/renderer/settings/PerformancePage.tsx`
- Modify: `electron/ipc/performance.ts`（若 settings 类型需扩展）

- [ ] **Step 1:** 新增 `RagInjectMode` 类型与设置项

```typescript
/** auto: 知识问答时自动注入片段；catalog: 仅注入文档目录；tool: 完全不自动检索，靠 search_knowledge */
export type RagInjectMode = 'auto' | 'catalog' | 'tool';
```

- [ ] **Step 2:** 恢复并增强 `looksLikeKnowledgeQuery()`（替换当前 deprecated 注释中的宽松逻辑）
  - 排除纯寒暄（已有 `isCasualChat`）
  - 命中以下任一则视为知识问答：问句标记（`?`、`吗`、`什么`、`如何`）、用户消息含已导入文档 filename 子串、长度 ≥ 8 且非纯 emoji

- [ ] **Step 3:** `shouldRunRag()` 拆为两个函数：
  - `shouldInjectRagCatalog(hasDocuments)` — catalog 模式及以上
  - `shouldAutoRetrieveRag(query, hasDocuments, mode)` — 仅 `auto` 且 `looksLikeKnowledgeQuery`

- [ ] **Step 4:** `context-builder.ts` 调整：
  - 始终（在 catalog/auto 模式下）注入 **精简 catalog**（仅文件名列表，去掉 chunk 数/导入时间以降低 token）
  - 仅 `shouldAutoRetrieveRag` 为 true 时调用 `retrieveRelevantChunks`

- [ ] **Step 5:** Performance 设置页增加「RAG 注入模式」三选一；默认 **`catalog`**

- [ ] **Step 6:** 单测覆盖三种 mode + 寒暄 + 知识问句

**验收：**
- 默认模式下发送「你好」→ 无 embedding 调用、无 reference 块
- 发送「需求文档里登录流程是什么」→ 自动检索并注入（auto 模式）或仅 catalog（catalog 模式）

---

### Task R1-3：检索结果按文档去重

**Files:**
- Modify: `src/rag/vector.ts` 或 `src/rag/retriever.ts`
- Modify: `src/rag/__tests__/vector.test.ts`

- [ ] **Step 1:** 实现 `topKBySimilarityDiverse(items, k, maxPerDocument = 2)`
  - 按 score 降序遍历，同一 `documentId` 最多保留 `maxPerDocument` 条

- [ ] **Step 2:** `retrieveRelevantChunks` 使用该函数替代裸 `topKBySimilarity`

- [ ] **Step 3:** 单测：10 个 chunk 同属 doc-A + 2 个属 doc-B，limit=5 → doc-A 最多 2 条

**验收：** 长文档场景下 top-5 至少覆盖 2 个不同文档（fixture 测试）。

---

### R1 整体验证

```bash
pnpm test src/rag
pnpm test src/config
```

- [ ] 手动：导入 2 份 MD，长文档一份；问跨文档问题，确认去重与 catalog 行为
- [ ] 确认 `search_knowledge` 工具在 catalog/tool 模式下仍可主动检索

**建议 commit：**

```bash
git commit -m "perf(rag): chunk cache, inject modes, and diverse top-k"
```

---

# Phase R2：分块与混合检索

**交付物：** Markdown 感知分块；document_chunks FTS5；向量 + BM25 RRF 融合；可配置相似度阈值。

### Task R2-1：Markdown 结构化分块

**Files:**
- Modify: `src/rag/chunker.ts`
- Modify: `src/rag/__tests__/chunker.test.ts`
- Modify: `src/rag/text-import.ts`（写入 chunk 时附带 section 标题 metadata，若 schema 已扩展）

- [ ] **Step 1:** 新增 `splitMarkdownIntoChunks(text, options?)`
  - 先按 `\n(?=#{1,3}\s)` 切 section
  - section 长度 ≤ `CHUNK_SIZE` 则整段为一个 chunk
  - 超长 section 再调用现有 `splitTextIntoChunks`，overlap 保留
  -  fenced code block（```）内不切分

- [ ] **Step 2:** `splitTextIntoChunks` 保留为 plain 回退；`.md` 导入走 markdown 路径

- [ ] **Step 3:** 单测 fixture：
  - 含 `## 标题` + 列表 + 代码块的真实 MD 片段
  - 断言 chunk 不截断代码块、标题与正文尽量同块

**验收：** 导入 `docs/oa-management-system-requirements-v2.md`（或同类）后，chunk 边界落在 section 附近。

---

### Task R2-2：document_chunks FTS5

**Files:**
- Create: `src/db/migrations/000X_rag_fts.sql`
- Modify: `src/rag/documents.ts`（insert/delete 同步 FTS）
- Create: `src/rag/hybrid.ts`

- [ ] **Step 1:** Migration（参考 worldbook_fts 模式）

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  content,
  filename,
  content='document_chunks',
  content_rowid='rowid'
);
-- 注：document_chunks 需有稳定 rowid；若 sql.js 行为与原生不一致，改用独立 fts 表存 chunk_id + content
```

> **实施注意：** 若 `document_chunks` 使用 TEXT PRIMARY KEY 导致 FTS content-sync 复杂，可简化为 **独立 FTS 表**（`chunk_id`, `content`, `filename`），insert/delete 时手动维护。优先选实现简单、测试可过的方案。

- [ ] **Step 2:** `searchChunksFts(query, limit)` — 分词 token 与 worldbook 相同策略

- [ ] **Step 3:** 单测：精确关键词命中、中文 2 字 token

---

### Task R2-3：RRF 混合检索

**Files:**
- Modify: `src/rag/retriever.ts`
- Create: `src/rag/__tests__/hybrid.test.ts`

- [ ] **Step 1:** `reciprocalRankFusion(denseRanks, sparseRanks, k=60)` 实现

- [ ] **Step 2:** `retrieveRelevantChunks` 流程：
  1. dense: top-20 by cosine
  2. sparse: top-20 by FTS（FTS 不可用时 skip）
  3. RRF 融合 → 取 top-`limit`
  4. 再应用 `maxPerDocument` 去重（R1）
  5. 过滤 `score >= minScore`

- [ ] **Step 3:** `MIN_SCORE` 改为从设置/env 读取，默认 0.35；Performance 页或 `.env` 暴露 `RAG_MIN_SCORE`

- [ ] **Step 4:** 单测：fixture 中仅关键词匹配 / 仅语义匹配 / 两者兼有

**验收：** 对含明确产品代号、版本号的文档，混合检索 Recall@5 优于纯向量（手工对比记录于 PR）。

---

### R2 整体验证

```bash
pnpm test src/rag
pnpm run db:reset   # 或迁移脚本，确保 FTS migration 可重复应用
```

- [ ] 重新导入测试文档，确认 FTS 行与 chunk 一致
- [ ] 删除文档后 FTS 无残留

**建议 commit：**

```bash
git commit -m "feat(rag): markdown chunking and hybrid fts retrieval"
```

---

# Phase R3：文档生命周期与边界

**交付物：** 导入 content hash 去重；embedding 模型元数据与维度校验；对话归档语义去重。

### Task R3-1：Schema 扩展 — 文档元数据

**Files:**
- Create: `src/db/migrations/000Y_rag_metadata.sql`
- Modify: `src/db/schema.ts`, `src/rag/documents.ts`, `src/rag/text-import.ts`

- [ ] **Step 1:** `documents` 表追加列（若已存在则跳过）：
  - `content_hash TEXT` — SHA-256 of normalized text
  - `embedding_model TEXT` — 导入时 embedding 模型名
  - `embedding_dim INTEGER`

- [ ] **Step 2:** 导入前计算 hash；若 hash 已存在 → 返回已有 `DocumentInfo` 或提示「已导入」由产品决定（默认 skip 并返回 existing）

- [ ] **Step 3:** 启动时或设置页「测试 Embedding」成功后，若 DB 中 `embedding_dim` 与当前模型不一致 → 设置页警告 + 提供「重建全部向量」按钮（后台任务，进度 IPC）

---

### Task R3-2：Rebuild embeddings 任务

**Files:**
- Create: `src/rag/reindex.ts`
- Modify: `electron/ipc/documents.ts`
- Modify: `src/renderer/settings/DocumentsPage.tsx`（或 Performance 页）

- [ ] **Step 1:** `reindexAllDocuments(onProgress?)` — 逐文档读文件 → 重新分块 → embed → 事务替换 chunks

- [ ] **Step 2:** IPC `documents:reindex` + UI 按钮（需二次确认）

- [ ] **Step 3:** 完成后 invalidate chunk cache + FTS 重建

**验收：** 切换 embedding 模型后点击重建，检索恢复；旧维度 mismatch 不再静默。

---

### Task R3-3：对话归档语义去重

**Files:**
- Modify: `src/rag/conversation-knowledge.ts`
- Reuse: `src/memory/dedupe.ts` 中的语义相似逻辑

- [ ] **Step 1:** 归档提炼完成后，对摘要首段做 embedding，与已有文档首 chunk 比 similarity

- [ ] **Step 2:** 若 max similarity > 0.92（可配置），则 **更新** 已有文档（reindex 该 doc）而非新建 — 或返回提示让用户选择（V1 可简化为：高相似则 skip 并告知已存在）

- [ ] **Step 3:** 单测 mock embedding 相似度边界

**验收：** 同一会话重复「计入知识库」不产生多份高度重复文档。

---

### R3 整体验证

- [ ] 同一 MD 导入两次 → 第二次 skip
- [ ] 修改 embedding 模型配置 → 警告 + reindex 可用

**建议 commit：**

```bash
git commit -m "feat(rag): document hash dedup and reindex pipeline"
```

---

# Phase R4：体验增强（可选）

**交付物：** Lazy RAG 与工具分工文档化；PDF/DOCX 导入；EmbeddingStore 抽象落地。

### Task R4-1：PDF/DOCX 导入知识库

**Files:**
- Modify: `src/rag/importer.ts`
- Reuse: `src/tools/doc/convert-markdown.ts` 中的转换逻辑（提取为 `src/rag/format-converters.ts` 避免循环依赖）

- [ ] **Step 1:** 允许 `.pdf` / `.docx` 扩展名；大小限制保持 10MB

- [ ] **Step 2:** 导入管线：binary → markdown text → `importTextAsKnowledge`

- [ ] **Step 3:** 单测：mock  converter，断言 importer 调用链

**验收：** 设置页可导入 DOCX/PDF，检索可命中内容。

---

### Task R4-2：EmbeddingStore 实现

**Files:**
- Modify: `src/rag/embedding-store.ts`
- Create: `src/rag/sqljs-embedding-store.ts`
- Modify: `src/rag/retriever.ts`（可选注入 store，默认仍用 chunk-cache）

- [ ] **Step 1:** `SqlJsEmbeddingStore` 实现 `search(query, limit)`，内部用 chunk-cache + topK

- [ ] **Step 2:** 为 Phase 4 后 sqlite-vec 替换预留构造函数注入点

**验收：** 接口单测通过；retriever 行为不变。

---

### Task R4-3：System prompt 优先级说明

**Files:**
- Modify: `src/agent/stable-context.ts` 或 persona 片段

- [ ] **Step 1:** 在稳定 system 前缀增加简短说明：
  - Worldbook → 行为与背景规则
  - 长期记忆 → 用户偏好与事实
  - RAG 引用 → 导入文档事实；冲突时以 RAG 引用为准

**验收：** 人工对话：Worldbook 与 RAG 内容冲突时，模型倾向引用 RAG 来源。

---

### R4 整体验证

- [ ] PDF/DOCX 样例导入成功
- [ ] `tool` 模式下 Agent 能通过 `search_knowledge` 完成纯工具检索问答

**建议 commit：**

```bash
git commit -m "feat(rag): docx/pdf import and embedding store abstraction"
```

---

## 配置项汇总（实施后）

| 键 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `RAG_ENABLED` | bool | true | 总开关（已有） |
| `RAG_INJECT_MODE` | `auto` \| `catalog` \| `tool` | `catalog` | 自动注入粒度（R1） |
| `RAG_MIN_SCORE` | number | 0.35 | 相似度阈值（R2） |
| `RAG_MAX_CHUNKS_PER_DOC` | number | 2 | 去重上限（R1） |
| `RAG_ARCHIVE_DEDUPE_THRESHOLD` | number | 0.92 | 归档语义去重（R3） |

---

## 测试策略

| 层级 | 内容 |
|------|------|
| 单元 | chunker、vector、hybrid RRF、chunk-cache、shouldAutoRetrieveRag |
| 集成 | import → retrieve 端到端（内存 DB fixture） |
| 回归 fixture | 固定 `fixtures/rag/sample-requirements.md` + 10 个 golden questions |
| 手工 | 设置页三种 inject mode；长文档多 chunk；切换 embedding 模型 + reindex |

```bash
pnpm test src/rag
pnpm test src/config
pnpm test src/agent   # 若 context-builder 单测存在
```

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| sql.js FTS5 与原生行为差异 | R2 优先独立 FTS 表；充分单测 insert/delete 同步 |
| 收紧注入后模型「不知道有知识库」 | 默认 `catalog` 仍注入文件名列表；stable-context 保留 search_knowledge 指引 |
| Reindex 大文档耗时 | 进度 IPC + 可取消；分批 embed（已有 batch=10） |
| Markdown 分块改变 chunk 边界 | 视为 breaking change for 已导入文档；R3 reindex 或提示用户重新导入 |

---

## 不在本计划范围

- sqlite-vec / HNSW 向量索引（chunk > 10000 再立项）
- Cross-encoder / LLM rerank（召回仍不足时再考虑）
- 多模态 PDF（图片页 OCR）
- 知识库 UI：文档内搜索、chunk 预览编辑（可另开 M7+ Task）

---

## 与主计划（PLAN.md）关系

| 主计划 Task | 关系 |
|-------------|------|
| M7-4 Token 优化 | R1 为其 **RAG 专项深化**（inject mode 默认 catalog） |
| M5 RAG | 本计划为 M5 **后续修复**，不推翻原有 IPC/API |
| M7-2 文档工具 | R4 PDF/DOCX 导入可复用 convert-markdown |

建议在 `docs/PLAN.md` M5 小节追加链接：

```markdown
- 后续优化：[RAG 优化计划](./superpowers/plans/2026-07-01-rag-optimization.md)
```

---

## 执行顺序建议

```
R1（必做，1d）→ R2（必做，1.5d）→ R3（推荐，1d）→ R4（按需）
     ↓                ↓
  可独立上线      需 R1 缓存 + 迁移
```

**最小可用修复：** 仅完成 **R1**，即可明显改善成本与性能。  
**质量达标修复：** 完成 **R1 + R2**。  
**生产可维护：** 完成 **R1 + R2 + R3**。

---

## 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-07-01 | 初稿：基于 M5 实现审计，分 R1–R4 四阶段 |
