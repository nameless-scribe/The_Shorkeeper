---
name: excel
description: 读取、分析、汇总工作区 .xlsx 文件，并生成新的 Excel 报表
metadata:
  shorekeeper:
    displayName: Excel 表格处理
    version: 1.1.0
    trigger: auto
    kind: capability
    matchKeywords: [xlsx, excel, 工作簿, 工作表, 电子表格, .xlsx]
    priority: 10
    allowedTools: [read_xlsx, update_xlsx_cells, gen_xlsx, list_dir, read_file]
    requiredTools: [read_xlsx]
---

【技能：Excel 表格处理】

处理工作区 `.xlsx` 文件。附件消息已有相对路径时直接使用；只有文件不明确时才列目录。

## 读取
- **.xlsx** 必须用 `read_xlsx`，禁止用 `read_file`（二进制无法解析）。
- 返回 JSON：`headers`、`rows`、`total_rows`、`start_row`、`returned_rows`、`has_more`。
- `has_more: true` 时用 `start_row + returned_rows` 作为下一页的 `start_row`，不要把当前页当作完整工作簿。
- 多工作表时查看 `available_sheets`，用 `sheet_name` 指定表名。
- **.csv / .txt** 用 `read_file`。

## 分析与回答
- 先读数据再计算，不要编造单元格内容。
- 汇总、透视、对比：在回复中给出关键数字与结论，必要时附简表。
- 大表优先回答用户关心的列/行；行数过多时说明抽样或截断范围。

## 写入选择
- 新建简单单 Sheet 报表使用 `gen_xlsx`。它只适合新文件，不用于保留原工作簿结构。
- 修改已有工作簿的少量单元格使用 `update_xlsx_cells`。它会保留其他 Sheet、公式和未修改单元格的格式；值应保持正确类型，不要把数字统一转成字符串。
- 大规模清洗、改列或重建表结构时，默认输出到新文件并保留源文件。只有用户明确要求覆盖且已说明会重建工作簿时，才覆盖原文件。
- 写入后根据用户目标核对关键单元格；不要仅凭工具返回 `success` 推断业务内容正确。

公式读取通常返回缓存结果而非公式文本。若任务要求审计公式或复杂格式，应说明当前读取能力的限制，不要编造公式内容。
