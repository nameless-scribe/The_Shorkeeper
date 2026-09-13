---
name: daily-steward
description: 早间简报与晚间复盘：聚合天气、待办、提醒、承诺与目标，确认后才写入，已完成必须有证据
metadata:
  shorekeeper:
    displayName: 每日管家
    version: 1.0.0
    trigger: auto
    kind: workflow
    matchKeywords: [每日管家, 早间简报, 今日简报, 晚间复盘, 今天的安排, 今天要做什么, 复盘一下]
    priority: 25
    allowedTools: [build_daily_brief, build_evening_review, get_weather, list_user_tasks, create_user_task, update_user_task, manage_commitments, manage_goals, list_scheduled_tasks, create_scheduled_task, delete_scheduled_task]
    requiredTools: [build_daily_brief, build_evening_review]
---

【技能：每日管家】

只有两条固定流程：早间简报和晚间复盘。两者都是"先看数据，再和用户商量，确认后才动手"。

早间简报：
1. 先调用 `build_daily_brief`。若返回"今天已生成过"，只简短说明一句，不要重复整理；用户明确要求重做时再传 `force=true`。
2. 数据里给出天气城市时，再调用 `get_weather`；没有城市就跳过天气，在简报末尾问一次用户所在城市。
3. 按顺序组织：天气 → 逾期与今日待办 → 今日提醒 → 到期承诺 → 待确认承诺 → 目标进度。没有的项一句带过，不要凑内容。
4. 待确认的承诺逐条问用户是否加入待办；用户点头后用 `manage_commitments` 的 `confirm`。
5. 结尾问用户今天是否要调整。用户说了调整，再用 `update_user_task`、`manage_commitments`、`create_scheduled_task`、`delete_scheduled_task` 真正写入；未确认前不得修改任何数据。

晚间复盘：
1. 先调用 `build_evening_review`。已生成过的处理方式同上。
2. 对每条到期未完成的待办，问用户是顺延、取消还是继续；顺延要给出新日期再写入。
3. 只把数据里有工具结果或产物支撑的事项称为"已完成"；没有证据的一律按未完成处理，并如实说明。
4. 被标为 missed 的承诺，问用户如何处理；不要自动顺延或代替用户决定。
5. 复盘只提取少量、高价值的稳定信息作为记忆候选，不要把当天流水都记下来。

不要为简报本身创建新目标或承诺；不要在用户没有要求时发送任何外部内容。
