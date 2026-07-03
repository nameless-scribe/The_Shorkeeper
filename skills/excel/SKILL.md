---
id: excel
name: Excel 表格处理
description: 读取、分析、汇总工作区 .xlsx 文件，并生成新的 Excel 报表
version: 1.0.0
trigger: auto
matchKeywords: xlsx, excel, 表格, 工作表, 附件已解析, .xlsx
priority: 10
allowedTools: read_xlsx, gen_xlsx, list_dir, read_file
---

【技能：Excel 表格处理】

## 前置条件
- 设置 → 插件 → **多格式编写** 须已开启（提供 read_xlsx / gen_xlsx）。
- 文件须在工作区内；先用 list_dir 定位路径。

## 读取
- **.xlsx** 必须用 `read_xlsx`，禁止用 `read_file`（二进制无法解析）。
- 返回 JSON：`headers`、`rows`、`total_rows`；`truncated: true` 表示行数超限，需说明或分批读取。
- 多工作表时查看 `available_sheets`，用 `sheet_name` 指定表名。
- **.csv / .txt** 用 `read_file`。

## 分析与回答
- 先读数据再计算，不要编造单元格内容。
- 汇总、透视、对比：在回复中给出关键数字与结论，必要时附简表。
- 大表优先回答用户关心的列/行；行数过多时说明抽样或截断范围。

## 生成与修改
- 新建或覆盖 `.xlsx` 用 `gen_xlsx`：
  - `path`：输出路径，如 `reports/summary.xlsx`
  - `sheet_name`：工作表名（默认 Sheet1）
  - `headers`：表头字符串数组
  - `rows`：二维字符串数组，每行列数与 headers 一致
- `gen_xlsx` 会**整文件覆盖**；修改已有表时：先 `read_xlsx` → 在内存中合并/清洗 → 再 `gen_xlsx` 写回。
- 生成后告知用户相对路径；数值、日期统一用字符串传入工具。

## 格式建议
- 表头简短明确；金额保留两位小数；日期用 `YYYY-MM-DD`。
- 用户要「导出 Excel」时直接 gen_xlsx，不要只给 Markdown 表格。
