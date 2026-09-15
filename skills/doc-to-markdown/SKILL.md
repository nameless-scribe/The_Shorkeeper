---
name: doc-to-markdown
description: 将 Word（doc/docx）、PDF（文字层）及 txt、csv、html 等文本文件转换为工作区 .md 文档
metadata:
  shorekeeper:
    displayName: 文档转 Markdown
    version: 1.3.0
    trigger: auto
    kind: capability
    matchKeywords: [转 markdown, 转为 markdown, word 转换, docx 转换, pdf 转换, .docx, .doc, .pdf]
    priority: 5
    allowedTools: [convert_to_markdown, list_dir, read_file, replace_text, gen_markdown, look_at_image]
    requiredTools: [convert_to_markdown]
---

【技能：文档转 Markdown】

将工作区内的 Word、PDF 或文本类文件转换为 Markdown。只有路径不明确时才使用 `list_dir`；附件消息已经给出相对路径时直接使用该路径。

- 使用 `convert_to_markdown`；`source_path` 必填，`output_path` 省略时生成同目录同名 `.md`。
- `.docx` 会尽量保留标题、段落、列表、链接和普通表格；复杂排版、浮动对象、批注及修订记录不保证保留。
- `.doc` 仅提取正文，不能承诺保留结构。
- `.pdf` 会重建表格（Markdown 表格，格内换行是 `<br>`），页面上的照片、图表抽到与 `.md` 同名的 `.assets/` 目录并以 `![第 N 页图 M](…)` 引用；每页正文前有 `<!-- page N -->` 标记，回答时可据此指出出处在第几页。图片只有文件没有内容识别，遇到"这张图是什么"只能给出路径与所在表格行。扫描件没有文字层：有图片时工具照常成功，Markdown 开头会写明"未支持 OCR，未能识别文字"，各页图片按原始分辨率（最长边至多 3600 像素）保留；此时如实告诉用户文字没有识别、图片在哪，不要猜内容；用户问内容时，用 `look_at_image` 看对应页的图片（`mode: read_text` 抄文字，图纸先读标题栏），一页一页看用户问到的那几页，不要把全部页面一次送去。既没文字也没图片的 PDF 才会报错。
- `.txt`、`.md`、`.csv`、`.html`、`.json`、`.xml`、`.yaml` 等按对应文本规则转换；不支持 RTF、PPT 和 XLSX。
- 转换成功只表示文件已生成。用户问"这份文件讲了什么"时，接着用 `read_file` 读输出的 `.md`（长文件按 `start_line/end_line` 分段）再作答，不要只汇报"已转换"。
- 多文件转换可逐个执行并汇总结果；任一文件失败时明确列出失败项，不把批次描述为全部成功。

不要用 `read_file` 读取二进制 Word 或 PDF 文件。转换后的局部修订应交给文本编辑能力；不要为了小改动用 `gen_markdown` 无条件覆盖整个文件。
