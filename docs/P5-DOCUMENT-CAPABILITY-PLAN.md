# P5 · 办公文档读写实施计划

> 计划验收入口：逐阶段补齐 `pnpm test:p5`
>
> 阶段编号沿用 P 系列。P0 任务闭环、P1 个人模型、P3 本地主动性、P4 录音转写均已完成。
> P5 补的是"看得懂、写得出办公文档"：PDF 可读、Word 可从零生成也可原位修改、图表可产出。
> P6（意图与追问）与 P7（数据源查询）依赖本阶段的产出工具，见第 8 节。

当前状态（2026-09-14）：**未开工**。本文是开工前的契约，不是验收记录。

---

## 1. 目标与边界

**要解决的**：用户手里的办公文档能进入助理的工作流，助理的产出能以用户真正会用的格式落地。
具体是四件事：

1. PDF 作为附件拖进来就能读（文字层）。
2. 助理收集完想法后能生成一份**有结构**的 Word（标题、列表、加粗、表格），而不是一堆纯文本段落。
3. 用户给一份现成 Word，助理能改其中的文字、**不动版式**。
4. 数据能变成图表产物（柱状 / 折线 / 饼图），供聊天预览与后续 P7 使用。

**同时解决的**：`gen_pdf` 用 Helvetica 标准字体，**中文一个字都渲染不出来**，且只出一页、超长静默丢弃。
它现在是个对中文用户不可用的工具。

**用户已明确的边界（2026-09-14）**：
- 手头没有扫描件 PDF，**OCR 整条线搁置**，只做文字层。
- Word 两种场景：一是"收集想法后输出整份"，二是"给一份现成的、改内容"；**不做重排版式**。
- Excel 结构化编辑"以后可能有"，本阶段只预留口子，不实现。

**不解决的**：见第 7 节。

---

## 2. 现状与缺口（2026-09-14 摸查）

| 能力 | 现状 | 缺口 |
|---|---|---|
| PDF 读 | `src/rag/format-converters.ts` 的 `convertPdfToMarkdown` 已能用 pdf-parse v2 抽文字层，但只服务知识库导入 | 未暴露成工具；`convert_to_markdown` 明确拒绝 `.pdf`；上传白名单没有 `.pdf` |
| Word 读 | `convert_to_markdown` 经 mammoth 转 HTML 再转 Markdown，**已支持表格、标题、列表、加粗、链接** | 无 |
| Word 生成 | `gen_docx` 输入是纯文本，按空行分段，全部是裸段落 | 不认 Markdown，无标题层级、列表、表格、强调 |
| Word 原位改 | 无 | 需要新工具。`update_xlsx_cells` 是完整模板：可预览契约 + `ctx.preview` 返回变更 + 修订号守卫 + 原子写入带备份 |
| PDF 生成 | `gen_pdf` 用 pdf-lib + Helvetica | 不能渲染中文；单页；行截断 90 字符 |
| Excel | `read_xlsx` / `gen_xlsx` / `update_xlsx_cells` 齐全，原位改保留公式格式 | 无增行、增表、写公式的结构化操作（本阶段不做） |
| 图表 | 无 | 需要新工具；`@napi-rs/canvas` 已是直接依赖但无人使用 |

依赖现状：`docx 9.x`、`mammoth`、`pdf-parse 2.x`、`pdf-lib`、`exceljs`、`@napi-rs/canvas` 都是直接依赖；
`jszip 3.10.1` 与 `xml-js` 只是传递依赖，**要用于 Word 原位修改必须提升为直接依赖并加进 vite externals**
（electron-builder 的打包白名单已经包含它们）。`@types/pdf-parse` 是 v1 的类型，与 v2 类 API 不匹配，顺手换掉。

---

## 3. 分层：与 P4 相同的三层

| 层 | 本阶段产出 |
|---|---|
| L1 能力 | Markdown → docx 结构映射（纯函数）；docx OOXML 文本替换（纯函数，输入输出都是 XML 字符串）；SVG 图表生成（纯函数） |
| L2 工具 | `convert_to_markdown` 接 `.pdf`；`gen_docx` 接 Markdown；新 `update_docx_text`；`gen_pdf` 改走 `printToPDF`；新 `gen_chart` |
| L3 技能 | `doc-compose`：收集想法 → 大纲 → 确认 → 生成 Word/PDF；`doc-to-markdown` 扩到 PDF |

原则不变：**L1 是纯函数、可测**；L2 声明副作用契约并走现有的预览确认；L3 只编排，不新增写路径。

---

## 4. 契约与数据

### 4.1 不新增持久化

本阶段没有新表。产物全部落工作区，由现有的 artifact 机制（sha256、备份、运行记录）记录。

### 4.2 `update_docx_text` 的契约

- `sideEffects: CONTENT_DEPENDENT_WRITE_CONTRACT`（可预览、非幂等，与 `replace_text` 同类）。
- 参数：`source_path`、`output_path?`（省略则覆盖源文件并留备份）、`edits[]`，每项 `{ find, replace, occurrence?: 'first' | 'all' }`，上限 200 项。
- 匹配单位是**段落文本**：把一个 `w:p` 下所有 `w:t` 拼成段落字符串再匹配，跨段落的 `find` 不支持（报错说明）。
- 替换策略：命中范围落在哪些 run 上，就把替换文本写进**第一个命中 run**、清空其余命中 run 的文本。
  这样保留的是第一个 run 的样式（字体、字号、加粗），版式、编号、表格结构一律不动。
- 预览：`kind: 'text-diff'`，`before`/`after` 是受影响段落的文本（不是整篇），`changes[]` 逐条给出。
- 修订号守卫：预览时算文件 `sha256:size`，执行时不一致即拒绝，与 xlsx 一致。
- 范围：v1 只改 `word/document.xml` 正文；页眉页脚、脚注、批注、修订记录（track changes）不碰，
  `find` 命中在这些区域时视为未命中。

### 4.3 `gen_docx` 接 Markdown

- 参数不变（`path`、`title`、`body`），但 `body` 按 Markdown 解析：`#`~`######` 标题、`-`/`1.` 列表（含嵌套两级）、
  `**粗体**`、`*斜体*`、GFM 管道表格、空行分段、`---` 分页。不认识的语法原样当文本。
- 解析结果是一棵简单 AST（纯函数，有测试），再映射到 `docx` 库的 `Paragraph` / `Table` / `TextRun`。
- 兼容：现在传纯文本的调用方（按空行分段）行为不变，因为纯文本就是只有段落的 Markdown。

### 4.4 `gen_pdf` 改走 Electron `printToPDF`

- Markdown → HTML（复用 4.3 的 AST 加一个 HTML 渲染器）→ 隐藏 `BrowserWindow` 加载 → `webContents.printToPDF`。
- 中文走系统字体，不需要打包任何字体文件；自动分页；表格与列表都能出。
- 隐藏窗口用完即销毁，走 S 系列的窗口生命周期约束；超时 30 秒。
- pdf-lib 仍保留给"合并、加页码"这类不需要排版的操作，本阶段不用。

### 4.5 `gen_chart`

- 参数：`path`（`.svg`）、`type: 'bar' | 'line' | 'pie'`、`title`、`labels[]`、`series[] { name, values[] }`。
- 纯函数生成 SVG 字符串，无外部库；配色、字号、留白固定，不给模型调样式的口子。
- PNG 是可选产物：先验证 `@napi-rs/canvas` 能否把 SVG 栅格化；能则同时出 `.png`，不能就只出 `.svg`。
  **不为这件事引入 chart.js 之类的运行时**。
- 聊天里的预览：复用现有工件卡片；若卡片不支持 `.svg` 内联显示，加一个只读预览，不做交互。

### 4.6 PDF 读的上限

- `.pdf` 加进上传白名单，归类 `office`，工具提示指向 `convert_to_markdown`。
- 转出的 `.md` 和其它文档一样经 `read_file` 分段读（单次 10 万字符上限）。
- pdf-parse 若能给出分页信息，每页前插 `<!-- page N -->` 注释，便于回指；给不出就不插，不为此换库。
- 文字层为空（扫描件）时**明确报错**"这份 PDF 没有文字层，需要 OCR，本版本未支持"，不返回空文件。

---

## 5. 实施阶段

### P5.0 — PDF 可读与 PDF 生成修复（1–2 天）

- `convert_to_markdown` 接 `.pdf`，委托给 `format-converters` 的现成函数；上传白名单加 `.pdf`。
- `gen_pdf` 改走 `printToPDF`（4.4）。这条放最前是因为它现在对中文用户是坏的。
- 固定样本：文字层 PDF、空文字层 PDF、超大 PDF（走分段读）、中文与表格的 PDF 输出。
- 建立 `pnpm test:p5`。

**阶段出口**：拖一份 PDF 进聊天框问"这份文件讲了什么"能得到基于正文的回答；让助理出一份含中文和表格的 PDF 能打开且排版正确。

### P5.1 — Word 从零生成（2–3 天）

- Markdown AST（纯函数）与 docx 映射（4.3）。
- `doc-compose` 技能：先问清主题、读者、篇幅、必须包含的要点，**给出大纲让用户确认**，再生成；
  生成后只汇报路径与结构，不复述全文。P6 落地前，确认走对话；P6 落地后改用 `ask_user`。
- 固定样本：多级标题、嵌套列表、表格、粗斜体混排、纯文本兼容。

**阶段出口**：一次"帮我把这些想法整理成一份方案"能得到结构正确的 `.docx`，用 Word 打开无格式错乱。

### P5.2 — Word 原位修改（3–4 天）

- L1：OOXML 段落文本替换纯函数（输入 `document.xml` 字符串与 edits，输出新字符串与变更列表）。
- L2：`update_docx_text`（4.2），预览、修订号、备份、原子写入全部复用现有机制。
- `jszip` 提升为直接依赖并加 vite externals；`@types/pdf-parse` 顺手处理。
- 固定样本：一段内多 run 命中、同一文本多处命中、表格单元格内文本、跨段落 `find`（应拒绝）、
  页眉中的文本（应视为未命中）、文件被外部修改后执行（应因修订号拒绝）。
- `workspace-doc-edit` 技能的 `allowedTools` 加入本工具，并补一条规则：改 Word 先 `convert_to_markdown` 看内容，再用原文精确匹配替换。

**阶段出口**：给一份带样式的 Word，说"把第三段的日期改成 9 月 30 日"，预览显示前后差异，确认后文件其余部分逐字节不变（用解压比对断言）。

### P5.3 — 图表产物（1–2 天）

- `gen_chart`（4.5）与预览。
- 固定样本：单系列柱状、多系列折线、饼图、空数据（应拒绝）、超过 50 个类目（应拒绝并建议聚合）。

**阶段出口**：`read_xlsx` 读出的数据能一句话变成图表并在聊天里看到。

### P5.4 — 回归与真实使用（1–2 天 + 观察）

- `pnpm test:p5`、全量、`typecheck`、`build`、`test:ui:strict`、`test:electron`。
- 真实使用记录：至少 3 份真实 Word 的原位修改、2 份从零生成、2 份 PDF 阅读。

**Excel 结构化编辑不在本阶段**。口子已留：`update_xlsx_cells` 的契约与预览形状可以直接扩展为
`edit_xlsx`（增行、增表、写公式），需求出现时按同一模板加，估 3–4 天。

---

## 6. 会影响哪些现有模块

- `src/workspace/allowed-extensions.ts`：白名单与工具提示加 `.pdf`。
- `src/tools/doc/convert-markdown.ts`、`gen-tools.ts`：接 PDF、Markdown、`printToPDF`。
- `src/tools/doc/`：新增 `update-docx-text.ts`、`gen-chart.ts`，以及 L1 纯函数文件。
- `electron/`：`printToPDF` 需要主进程开隐藏窗口，走 `windows/manager.ts` 的生命周期约束。
- `skills/`：新增 `doc-compose`；`doc-to-markdown` 与 `workspace-doc-edit` 的说明与工具白名单更新；契约测试的技能列表与验收脚本的技能数随之更新。
- `package.json` / `vite.config.ts`：`jszip` 直接依赖与 externals。

---

## 7. 明确不做

- **不做 OCR**。用户当前没有扫描件；需要时按 P4 选供应商的方式评估云端识别，不在本阶段引入本地识别运行时。
- **不做 Word 版式编辑**（分栏、页边距、样式表、图片位置）。原位修改只改文字。
- **不处理 Word 的修订记录与批注**。文件里有未接受的修订时，工具提示用户先在 Word 里接受或拒绝。
- **不做 PPT 生成**。PPT 读文字若有需求，按 `convert_to_markdown` 加一种扩展名处理，不进本阶段。
- **不做交互式图表**。图表是静态产物，有来源、可归档。
- **不引入图表运行时库**（chart.js、echarts 等）。三种基础图 SVG 手写足够，也不受 CSP 约束。
- **不做 Excel 结构化编辑**（见 5.4 末尾的预留说明）。
- **不为 PDF 生成打包字体文件**。`printToPDF` 用系统字体，安装包不变大。

---

## 8. 推荐开工顺序与停线条件

建议顺序：**P5.0 → P5.1 → P5.2 → P5.3 → P5.4**。

P5.0 最前，因为 PDF 读几乎是零成本暴露现成能力，而 `gen_pdf` 的中文问题是现存缺陷。
P5.1 在 P5.2 之前，因为 Markdown AST 是两者共用的零件，且从零生成没有"改坏用户文件"的风险，先拿到可见效果。
P5.3 放后面，它的主要消费者是 P7。

与 P6、P7 的关系：
- P6 的 `ask_user` 落地后，`doc-compose` 的"大纲确认"改走它；在此之前用对话确认，行为一致。
- P7 的结果导出直接用 `gen_xlsx` 与 `gen_chart`，因此 P5.3 是 P7 的前置。

出现以下任一情况立即停止扩大范围：

- 原位修改后文件里除目标段落之外的任何字节发生变化；
- 预览通过后未经确认就写入，或执行时未校验修订号；
- 为了某种排版效果开始在 OOXML 里手写样式；
- 扫描件 PDF 返回了空内容而没有报错；
- 为图表或 PDF 引入新的运行时库或字体文件；
- 技能开始自己拼写路径而不是 `list_dir` 确认；
- 生成整份 Word 时未经用户确认大纲就直接落盘。

---

## 9. 待确认

- **pdf-parse v2 是否提供分页文本**：决定 4.6 的页码注释能否实现。P5.0 开工时先验证。
- **`@napi-rs/canvas` 能否直接栅格化 SVG**：决定 `gen_chart` 是否同时出 PNG。不能就只出 SVG。
- **工件卡片对 `.svg` 的预览支持**：P5.3 开工时看 `FileAttachmentCard` 现状再定。
- **`printToPDF` 在打包后的窗口权限与 CSP**：隐藏窗口加载的是本地生成的 HTML，须走与主窗口相同的安全约束。

---

## 10. 实施记录

（开工后按"症状 → 证据 → 根因 → 修法"逐节追加，格式与 P4 第 10 节一致。）
