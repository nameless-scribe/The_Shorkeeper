---
name: workspace-doc-edit
description: 安全修改工作区内已有的 Markdown/文本文件；局部编辑优先精确替换，必要时才整文件重写
metadata:
  shorekeeper:
    displayName: 工作区文档维护
    version: 1.1.0
    trigger: auto
    kind: capability
    matchKeywords: [修改文档, 更新文档, 写回文件, 保存文件, 修订文档, 编辑 markdown, 编辑 .md]
    priority: 12
    allowedTools: [list_dir, read_file, replace_text, write_file, gen_markdown]
    requiredTools: [read_file, replace_text]
---

【技能：工作区文档维护】

维护工作区内已有的 Markdown 或文本文件。新建 Markdown 可使用 `gen_markdown`，不需要套用已有文件编辑流程。

1. 附件或工具结果已给出准确相对路径时直接使用；路径含糊时才用 `list_dir`。
2. 用 `read_file` 读取完成修改所需的范围。大文件使用 `start_line/end_line` 分段，不要求无条件读取全文。
3. 局部修改优先使用 `replace_text`，并提供精确原文和期望匹配次数；匹配数量不符时停止并重新读取。
4. 只有确实需要重写全文时才用 `write_file`，并确保已获得完整内容。不得用片段覆盖完整文件。
5. 写入工具已做原子写入与校验；只有需要验证语义或多处同步时才读回相关片段，不要机械读取全文。

若第 4 步未执行或用户拒绝写入权限，必须如实告知「文件未修改」，不得声称已完成。

## 多位置同步（结构化文档）
若文档在多处重复记录同一信息（如总览表 + 章节标题 + 清单表），更新状态或字段时须**同时**修改所有相关位置，保持全文一致。

示例（实施计划类文档）：
- **总览表**：`| 阶段 | … | 状态列 |`
- **章节标题**：`## … 阶段名：…`
- **交付清单**（若有）：`| 阶段 | … | 状态 |`

状态格式应沿用原文既有约定，不要擅自引入 emoji 或统一样式。只改用户指定的内容。

工具失败、用户拒绝写入或校验不通过时，明确说明文件未修改。不要把回复中的建议描述成已经落盘。
