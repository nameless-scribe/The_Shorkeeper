# P5 · 办公文档读写实施计划

> 计划验收入口：逐阶段补齐 `pnpm test:p5`
>
> 阶段编号沿用 P 系列。P0 任务闭环、P1 个人模型、P3 本地主动性、P4 录音转写均已完成。
> P5 补的是"看得懂、写得出办公文档"：PDF 可读、Word 可从零生成也可原位修改、图表可产出。
> P6（意图与追问）与 P7（数据源查询）依赖本阶段的产出工具，见第 8 节。

当前状态（2026-09-14）：**P5.0 已实现并通过自动化回归**（PDF 可读、`gen_pdf` 改走 `printToPDF`），
真实使用记录尚未开始；P5.1 至 P5.4 未开工。实施记录见第 11 节。

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
  （2026-09-15 更新：扫描图纸出现了，用户决定接百炼的千问视觉模型，单独立项为 `P8-VISION-PLAN.md`；本阶段仍只保证"图不糊、路径明确"。）
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

- 原位修改后，解压比对各部件：除 `word/document.xml` 的目标段落外，任何部件的字节发生变化（重新打包会改变 zip 本身的字节，因此以解压后的部件为准）；
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

## 10. 落地细节（2026-09-14 复核）

按"明天打开就能动手"的标准补的细节。与上文冲突时以本节为准。

### 10.1 P5.0 PDF 可读

- `src/workspace/allowed-extensions.ts`：`.pdf` 加进 `WORKSPACE_OFFICE_EXTENSIONS`（分类为 `office`，导入上限 20MB）；`workspaceFileToolHint('.pdf')` 返回 `convert_to_markdown`。
- `src/tools/doc/convert-markdown.ts`：新增 `PDF_EXT`，分支调用 `../../rag/format-converters` 的 `convertPdfToMarkdown`。文字层为空（去空白后 < 20 字符）时返回失败："这份 PDF 没有文字层（可能是扫描件），本版本未支持 OCR"。
- 分页：先在 P5.0 开工时验证 pdf-parse v2 的 `getText()` 返回里是否有逐页文本；有则每页前插 `<!-- page N -->`，没有就不插。
- 测试：`src/tools/doc/__tests__/convert-pdf.test.ts`，用 pdf-lib 在测试里现生成一份两页 PDF（英文即可，Helvetica 能画），断言转出的 Markdown 含两页文字；再生成一份无文字的空白 PDF，断言报错文案。

### 10.2 P5.0 `gen_pdf` 改走 `printToPDF`

- `src/tools` 不能引用 Electron。做法与权限确认相同：`src/documents/pdf-renderer.ts` 暴露 `setPdfRenderer(fn)`，`gen_pdf` 调用注入的函数；`electron/print/markdown-to-pdf.ts` 在主进程实现并在 `main.ts` 注入。
- 渲染函数：`new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } })`，
  `loadURL('data:text/html;base64,…')`，`webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 1.5, bottom: 1.5, left: 1.6, right: 1.6 } })`（单位 cm），
  `finally` 里 `destroy()`；总超时 30 秒。`javascript: false` 是硬要求：文档内容来自模型，不能执行脚本。
- HTML：由 10.3 的 AST 渲染，所有文本经 HTML 转义；内联 CSS 固定字体栈 `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`，表格加边框，标题层级字号固定。
- 测试：AST → HTML 渲染是纯函数，断言转义与结构；`printToPDF` 本身只在 `test:electron` 冒烟里验证（生成一份含中文与表格的 PDF，断言文件非空且以 `%PDF` 开头）。

### 10.3 P5.1 Markdown AST

- 依赖里没有 Markdown 解析库，也不为此引入：`src/documents/markdown-ast.ts` 自写一个**子集**解析器，约两百行，纯函数。
- 块级：`#`–`######` 标题、段落（空行分隔）、无序列表 `-`/`*`、有序列表 `1.`、嵌套（每级 2 个空格，最多两级）、GFM 管道表格（首行表头、第二行分隔）、`---` 分页。
- 行内：`**粗体**`、`*斜体*`、`` `代码` ``（docx 里用等宽字体，PDF 里用 `<code>`）、`[文本](链接)` 只保留文本。
- 不支持的语法原样当文本，绝不抛错。测试用固定样本覆盖每种块与行内、嵌套边界、空文档。
- 两个消费者：`markdown-to-docx.ts`（AST → `docx` 库对象）与 `markdown-to-html.ts`（AST → HTML 字符串）。

### 10.4 P5.2 `update_docx_text` 的 OOXML 处理

- 只处理 `word/document.xml`。用字符串级的宽容解析，不引入 XML 库：按 `<w:p` … `</w:p>` 切段，段内按 `<w:r` … `</w:r>` 切 run，run 内取 `<w:t …>…</w:t>` 文本并解码实体；`<w:tab/>` 计作 `\t`、`<w:br/>` 计作 `\n` 参与拼接（因此跨制表符的 `find` 不会命中，文档里写明）。
- 跳过：含 `<w:fldChar` 或 `<w:instrText` 的段落（域代码）不参与匹配。文件里出现 `<w:ins` 或 `<w:del`（修订记录）则整体拒绝，提示先在 Word 里接受修订。
- 替换：命中范围落在的第一个 run 写入替换文本（XML 转义 `& < >`，`<w:t xml:space="preserve">`），其余命中 run 的 `<w:t>` 清空但保留 run 节点与其 `<w:rPr>`。
- 重新打包：用 `jszip` 读取，按**原有条目顺序**写回，`compression: 'DEFLATE'`；除 `document.xml` 外的条目原样透传。验收用"解压后逐部件比对"，见第 8 节。
- `jszip` 提升为直接依赖并加 `vite.config.ts` externals；打包白名单已含。
- 测试样本用 `docx` 库现生成：多 run 段落（加粗片段拆 run）、同文本多处、表格单元格、含域代码段落、含修订记录文件。

### 10.5 P5.3 `gen_chart`

- `src/documents/chart-svg.ts` 纯函数：固定 800×480 画布、左右留白、6 色调色板、`<title>` 与 `<desc>`（来源写在 `<desc>`）。文本用 `font-family` 系统字体栈，与 10.2 相同。
- PNG：P5.3 开工时先跑一次 `@napi-rs/canvas` 的 `loadImage(Buffer.from(svg))`；能画就同时出 `.png`，否则只出 `.svg`，两种情况都在实施记录里写明。
- 预览：先看 `FileAttachmentCard` 是否按扩展名内联显示图片；`.svg` 走 `<img>` 即可（CSP `img-src` 已允许 `sk-asset:`），不需要脚本。

### 10.6 技能与测试入口

- `skills/doc-compose/SKILL.md`：`trigger: auto`，`matchKeywords: [写一份, 出一份, 整理成文档, 整理成方案, 生成 word, 写成 word, 做成 pdf, 生成 pdf]`，`priority: 14`，`allowedTools: [list_dir, read_file, gen_docx, gen_pdf, gen_markdown]`（P6.3 后加 `ask_user`）。与 `workspace-doc-edit` 的触发词不重叠；契约测试技能列表与验收脚本技能数加 1。
- `pnpm test:p5`：`src/documents/__tests__/*.test.ts`（AST、docx 映射、HTML 渲染、OOXML 替换、SVG）、`src/tools/doc/__tests__/*.test.ts`、`src/workspace/__tests__/import.test.ts`、`src/skills/__tests__/contracts.test.ts`。

## 11. 实施记录

（按"症状 → 证据 → 根因 → 修法"逐节追加，格式与 P4 第 10 节一致。）

### 11.1 P5.0 PDF 可读与 `gen_pdf` 改走 `printToPDF`（2026-09-14）

开工前验证了第 9 节的两个待确认项：**pdf-parse v2 的 `getText()` 自带逐页文本**
（`TextResult.pages[]`，每项 `{ num, text }`），页码注释可以做；`@napi-rs/canvas` 栅格化
SVG 的验证留到 P5.3。第 10.2 节写的页边距"单位 cm"是错的，Electron `PrintToPDFMargins`
只收英寸，实现里按 cm 换算。

| 层 | 文件 | 说明 |
|---|---|---|
| L1 | `src/documents/markdown-ast.ts` | Markdown 子集解析器（10.3 的全部语法），纯函数；单行换行保留为软换行，纯文本调用方按行分段的效果不变 |
| L1 | `src/documents/markdown-to-html.ts` | AST → 全转义 HTML，内联固定样式与字体栈；P5.1 的 docx 映射复用同一 AST |
| L1 | `src/rag/format-converters.ts` | `extractPdfText`（逐页）、`hasPdfTextLayer`（去空白不足 20 字即无文字层）、`convertPdfToMarkdown` 加 `pageMarkers` 选项 |
| 注入点 | `src/documents/pdf-renderer.ts` | `setPdfRenderer` / `renderHtmlToPdf`；未注入时抛错，产物不以 `%PDF` 开头也抛错 |
| 主进程 | `electron/print/markdown-to-pdf.ts` | 隐藏窗口 + `printToPDF`；`main.ts` 启动时注入，退出时 `shutdownPdfPrintRuntime()` 销毁在打印的窗口 |
| L2 | `src/tools/doc/gen-tools.ts` | `gen_pdf`：校验 `.pdf` 后缀、正文 20 万字上限、渲染器就绪，再走原有的原子写入 |
| L2 | `src/tools/doc/convert-markdown.ts` | 接 `.pdf`，每页前插 `<!-- page N -->` |
| 白名单 | `src/workspace/allowed-extensions.ts` | `.pdf` 归 `office`、提示 `convert_to_markdown`；选择文件对话框分组改名"Office、PDF 与表格" |
| 技能 | `skills/doc-to-markdown/SKILL.md` | 1.2.0：接 PDF，触发词加 `.pdf` / `pdf 转换`，要求转换后接着读 `.md` 再回答 |
| 入口 | `package.json` | `pnpm test:p5`；`scripts/electron-runtime-smoke.cjs` 新增 `printToPDF` 冒烟 |

几个不显然的决定：

- **扫描件报错而不是空文件，知识库导入同样适用**。`convertPdfToMarkdown` 是 RAG 与工具共用的，
  改在共用层：导入一份扫描件现在会以"未支持 OCR"失败，而不是入库一篇只有标题的空文档。
- **页码注释只给工具，不给知识库**。`<!-- page N -->` 进了检索切片只会稀释召回；导入路径默认不插。
- **`pageJoiner: ''`**。pdf-parse 默认在每页末尾追加 `-- 1 of 2 --`，与自己标的页码重复，关掉。
- **`***粗斜***` 的闭合**：三连星号收尾且内部还有未闭合单星号时，把第一个星号让给斜体；
  不这么做会解析成"粗体 + 游离星号"。
- **松散列表只在同类项之间延续**：空行后若顶层从无序换成有序，视为新列表，否则编号会被吞进上一个列表。

**打印窗口的两次返工**（都出在冒烟里，vitest 测不到）：

1. 症状：`printToPDF` 冒烟 `ERR_FAILED (-2)`，但单独跑同样的代码却能通过。
   证据：给 `webRequest.onBeforeRequest` 加日志，能看到 `data:` 主框架导航被送进了监听器，
   即便 callback 放行也失败。根因：不带 URL 过滤器的 `webRequest` 会介入 `data:` 导航，
   Chromium 对非网络请求无法恢复。修法：过滤器改成 `{ urls: ['*://*/*'] }`，只拦 `scheme://host`
   形式的外发请求，`data:` 根本不进监听器。冒烟里故意放一个 `http://127.0.0.1:9/` 的图片，
   断言它被拦下。
2. 症状：修完仍报 `ERR_FAILED`，且**退出码是 0**——`pnpm test:electron` 把失败当成了通过。
   根因：前一项检查销毁自己的窗口后，全部窗口已关闭，Electron 默认的 `window-all-closed`
   行为开始退出应用；打印窗口是在退出途中创建的，加载必然失败，而退出路径先于 `app.exit(1)`
   结束进程。修法：冒烟脚本加空的 `window-all-closed` 监听（它本来就在末尾显式 `app.quit()`）。
   其它 `*-smoke.cjs` 没有这个守卫，目前各自只在末尾关窗所以没踩到，留作观察项。

真实应用里不会踩第 2 条：聊天窗隐藏到托盘时并未关闭，`window-all-closed` 不会触发。

验收：`pnpm typecheck`、`pnpm test:p5`（11 个文件 85 用例）、全量 940 用例、`pnpm build`、
`pnpm test:electron`（运行时冒烟含 `printToPDF`，产物 31 KB、拦截 1 个外发请求；窗口生命周期冒烟）均通过。
端到端手工验证：用真实渲染器把一份含二级标题、三列表格、两级列表、粗斜体、`<script>` 文本、
`---` 分页与 80 段中文正文的 Markdown 打成 4 页 PDF，截图核对中文落到微软雅黑、表格有边框、
脚本按文字显示；再用 `convert_to_markdown` 读回，4 个页码注释、表格文字与"星泓科技"都在。

**未做 / 待真实使用**：拖 PDF 进聊天框问"这份文件讲了什么"这条阶段出口需要真人在应用里走一遍
（自动化只到工具层）；`@types/pdf-parse` 仍按计划留到 P5.2 顺手处理。

### 11.2 P5.0 返工：PDF 不是纯文本，要按版面读（2026-09-15）

**症状**：用户拖入一份真实的《检测设备表》PDF（4 页，每页一张带照片列的设备表），转出的 Markdown
"少很多东西、还有错位"。核对后：文字一条没少，丢的是**整列照片**，错位是**表格结构**没了——
单元格内的换行被当成新行，"日本三丰自动三次 / 元测定机"断成两行，标题跑到页尾。

**证据**：pdf-parse 的 `getText()` 只给阅读顺序的纯文本；它自带的 `getTable()` 在这份文件上找到
0 张表。dump 绘图指令发现：538 个路径操作全是 **fill**（单元格底色），没有一条描边线，
而 `getTable()` 的实现里 `if (op !== stroke) continue`。照片方面，第 1 页视觉上 7 张，但 531 次
画图指令里只有 4 个"整幅"的图片对象——其余 3 张被导出器（WPS）切成 0.4 pt 的细条或 7 pt 的
横块，每条一个独立的图片对象，pdf-parse 的 80 px 尺寸阈值把它们全过滤掉了。

**根因**：把 PDF 当成"文字层 + 装饰"。PDF 里没有表格和图片的语义，只有坐标；不重建版面就
不可能读对表格，也不可能知道照片在哪一格。

**修法**（用户的判断"不能假设 PDF 里只有文字"是对的，因此改成通用的版面分析，不是只修这一份）：

| 层 | 文件 | 说明 |
|---|---|---|
| 版面 | `src/documents/pdf-layout.ts` | 用 pdfjs-dist 取绘图指令：填充 + 描边的矩形与线段交给 pdf-parse 公开的 `LineStore` 重建网格；文字按水平中点落格，压在格线上的整段文字按字符宽度估算在最近的空白处切开；图片按位置归格子 / 自由区域，条块按"对齐且相接"**在同一格子内**拼回一张 |
| 渲染 | `src/documents/pdf-markdown.ts` | 段落、GFM 表格（`<br>` 格内换行、横跨整表的标题行作加粗段落）、`![]()` 按纵向位置排序输出 |
| 抽图 | `src/documents/pdf-images.ts` | 从 `page.objs` 解像素（RGB / RGBA / 1 位黑白），拼接条块，落成最长边 1280 的 JPEG；必须在 `page.cleanup()` 前完成 |
| 入口 | `src/rag/format-converters.ts` | `extractPdfDocument` 单次加载完成分析与抽图；`convert_to_markdown` 抽到 `<同名>.assets/`，知识库导入不抽图、不插页码注释 |
| 依赖 | `package.json` | `pdfjs-dist@5.4.296` 提升为直接依赖（pdf-parse 不公开底层文档对象；版本与 pdf-parse 锁定一致，安装包里没有第二份） |

三次返工才把两份真实文件读全，每次都是靠 dump 绘图指令找到的：

1. 包围盒是 `Float32Array`，`Array.isArray` 判断把所有矩形都过滤掉了——表格识别数从 0 到 4。
2. 按图片对象名合并条块不行：每条都是独立对象。改成按几何位置拼，先用"细条 < 3 pt"的固定阈值，
   拼回了 6/7；剩下那张是 7 pt 的横块。去掉阈值，改成"对齐且相接"的并查集——7/7。
3. 换到《加工设备表》：相邻三行的照片贴边相接被拼成一张 244 pt 高的图。拼接改成只在同一格子内进行——8/8。
   同一份文件里"KBT-13.A"与"3000*2000*1300"分属两列却归到了一格：后者的起点正好压在格线上，
   `findCell` 在共享边上先命中左格。改按文字水平中点找格子。

**结果**：《检测设备表》4 页 4 张表、29 张照片全部到位（2.3 秒，1.8 MB）；《加工设备表》6 页 6 张表、
52 张照片；一份日文机械图纸转出的是散落的尺寸标注（图纸本身如此，不算回归）。
自动化：`pdf-layout.test.ts` 覆盖行/段分组、条块拼接、跨格切分与 Markdown 渲染；
`convert-pdf.test.ts` 用 pdf-lib 现画底色表格、边框表格、格内与自由区域各一张图，断言表格重建、
`<br>`、前后文本顺序、`.assets/` 落盘与 JPEG 魔数；`format-converters.test.ts` 改用真实 PDF 样本，
不再 mock pdf-parse。

**明确不做**：内联图（`paintInlineImageXObject` 没有对象名，解不出像素）；单元格底纹若被画成
≥ 24 pt 的图片块会被当成图片抽出（目前两份文件里没有）。

### 11.3 扫描图纸：分辨率与"无文字层"的处理（2026-09-15）

**症状**：用户上传 6 页加工零件图纸的 PDF，工具报"未支持 OCR"失败，但 `.assets/` 里已经有了
每页一张图；让助理拼了个 HTML 预览页后发现图"清晰度太差"，尺寸标注看不清。

**证据**：源文件是 600 dpi 扫描（每页 4948×7000 像素，切成 7 条），输出是 905×1280——
最长边上限 1280 把它缩了 5.5 倍。糊是这边压的，不是源头糊。同时暴露出顺序问题：图片在逐页
分析时就落盘，文字层检查在最后，失败时产物已经写进了工作区。

**修法**：
- `pdf-images.ts` 最长边上限 1280 → 3600（A4 约 300 dpi），条块拼接密度上限 4 → 6 px/pt；
  照片类小图仍按原始分辨率、不放大。一页 300 dpi 图纸 JPEG 约 1 MB。
- 无文字层不再一律报错：抽到了图片就成功，Markdown 开头加一行说明"未支持 OCR，未能识别文字"，
  工具输出与 `metadata.textLayer=false` 同步说明；既没文字也没图片才报错。知识库导入不抽图，行为不变。
- 测试：`convert-pdf.test.ts` 新增整页大图的"扫描件"样本（两页复用同一张图），断言成功、说明文字、
  每页图片引用，且输出图片尺寸原样保留。
- 这条测试顺手抓出一个会挂死的 bug：跨页复用的图片对象在 pdf.js 里以 `g_` 开头、存在 `commonObjs`，
  我原来按 `commonObjs.has()` 判断，对象尚未解析完时它返回 false，于是去 `page.objs` 上等一个永远不来的
  回调。改成按名字前缀选对象表（pdf.js 内部就是这么做的），并给对象解码加了 20 秒超时——超时只算
  这一张图抽取失败，整次转换照常完成。

**没做的**：真正读懂图纸要 OCR 或视觉模型，按第 7 节仍搁置；现在做到的是"图不糊、路径明确、
不假装读到了文字"。
