---
name: doc-to-markdown
description: 将 Word（doc/docx）及 txt、csv、html 等文本文件转换为工作区 .md 文档
metadata:
  shorekeeper:
    displayName: 文档转 Markdown
    version: 1.1.0
    trigger: auto
    kind: capability
    matchKeywords: [转 markdown, 转为 markdown, word 转换, docx 转换, .docx, .doc]
    priority: 5
    allowedTools: [convert_to_markdown, list_dir, read_file, replace_text, gen_markdown]
    requiredTools: [convert_to_markdown]
---

【技能：文档转 Markdown】

将工作区内的 Word 或文本类文件转换为 Markdown。只有路径不明确时才使用 `list_dir`；附件消息已经给出相对路径时直接使用该路径。

- 使用 `convert_to_markdown`；`source_path` 必填，`output_path` 省略时生成同目录同名 `.md`。
- `.docx` 会尽量保留标题、段落、列表、链接和普通表格；复杂排版、浮动对象、批注及修订记录不保证保留。
- `.doc` 仅提取正文，不能承诺保留结构。
- `.txt`、`.md`、`.csv`、`.html`、`.json`、`.xml`、`.yaml` 等按对应文本规则转换；不支持 PDF、RTF 和 XLSX。
- 转换成功只表示文件已生成。用户要求核对内容时，再读取输出文件的相关片段进行语义检查。
- 多文件转换可逐个执行并汇总结果；任一文件失败时明确列出失败项，不把批次描述为全部成功。

不要用 `read_file` 读取二进制 Word 文件。转换后的局部修订应交给文本编辑能力；不要为了小改动用 `gen_markdown` 无条件覆盖整个文件。
