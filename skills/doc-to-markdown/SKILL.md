---
id: doc-to-markdown
name: 文档转 Markdown
description: 将 Word（doc/docx）及 txt、csv、html 等文本文件转换为工作区 .md 文档
version: 1.0.0
trigger: auto
matchKeywords: 转 markdown, docx, word, 转换, .doc
priority: 5
allowedTools: convert_to_markdown, list_dir, read_file, gen_markdown
---

【技能：文档转 Markdown】

## 前置条件
- 设置 → 插件 → **多格式编写** 须已开启。
- 源文件须在工作区内；先用 `list_dir` 确认路径。

## 转换流程
1. 确认源文件路径与格式。
2. 调用 `convert_to_markdown`：
   - `source_path`：源文件，如 `docs/报告.docx`
   - `output_path`：可选；省略则输出为同目录同名 `.md`（如 `docs/报告.md`）
3. 转换完成后告知用户输出路径；聊天中会出现可点击打开的 .md 文件卡片。

## 格式支持
| 类型 | 方式 |
|------|------|
| `.docx` | 保留标题、列表、表格等结构（mammoth） |
| `.doc` | 提取正文为 Markdown 段落（旧版 Word） |
| `.txt` `.md` `.csv` `.html` `.json` `.xml` `.yaml` 等 | 按文本规则转为 Markdown |

不支持：`.pdf`、`.xlsx`（请用 Excel 技能或请用户先另存为 docx/txt）。

## 禁止事项
- 不要用 `read_file` 读取 `.doc` / `.docx`（二进制会乱码）。
- 不要只把内容贴在回复里而不落盘；用户要文件时应写入工作区。

## 批量转换
多个文件时逐个调用 `convert_to_markdown`，汇总列出输入→输出路径。

## 微调
转换后若需小改标题或补 frontmatter，可用 `read_file` 查看再用 `gen_markdown` 覆盖写入。
