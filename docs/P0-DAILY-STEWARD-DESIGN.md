# P0 实现说明：目标、承诺与每日管家

> 版本：1.0.0（已实现，待真实使用验收）
> 日期：2026-09-13
> 前置：`docs/P0-TASK-LOOP.md` 已落地的运行记录、审批、产物与工具契约
> 目的：记录蓝图 P0 剩余两项（Goal / Commitment 对象、每日简报到晚间复盘）的最终设计、实现边界与验收状态

---

## 1. 三个对象的关系

现有 `user_tasks`（待办）和 `scheduled_tasks`（提醒）已经承担"要做什么"和"何时提醒"。新对象不重复它们，只补"为什么做"和"答应了谁"。

| 对象 | 回答的问题 | 生命周期 | 数量级 |
|---|---|---|---|
| Goal 目标 | 这段时间我在往哪里推进 | 周到月，`active → paused / done / dropped` | 个位数 |
| Commitment 承诺 | 谁在什么时候之前答应了什么 | 天到周，`proposed → open → done / missed / cancelled` | 每周几条 |
| user_task 待办 | 今天/这周具体要做的事 | 不变 | 几十条 |
| scheduled_task 提醒 | 何时弹窗 | 不变 | 不变 |

**核心规则：待办仍是唯一的"做事清单"，承诺不另起一张清单。**

- 用户的承诺（"周五前把报告交给老板"）**必须**关联一条待办；没有就自动创建同标题、同截止的待办。承诺只在待办之上追加：答应了谁、来源对话、跟进时间、完成证据。
- 助理的承诺（"我明早八点提醒你"）就是一条提醒任务，承诺记录只是指向它的引用。
- 目标通过 `goal_id` 挂在待办和承诺上；简报按目标分组展示待办，没有目标的归到"其他"。

```
goals ─┬─< user_tasks (goal_id 可空)
       └─< commitments (goal_id 可空)
                ├── owner = user      → task_id 指向 user_tasks（必有）
                └── owner = assistant → scheduled_task_id 指向 scheduled_tasks（必有）
commitments.evidence_run_id / evidence_artifact_id → task_runs / artifacts（完成证据）
```

### 1.1 表结构（migration `0022_goals_commitments.sql`）

```sql
goals(id, title, description, status, priority, target_date, created_at, updated_at, closed_at)
commitments(id, goal_id, title, owner, status, due_at, promised_to, source_session_id,
            source_run_id, task_id, scheduled_task_id, evidence_run_id, evidence_artifact_id,
            last_followed_up_at, created_at, updated_at, closed_at)
briefings(id, brief_date, kind, run_id, status, summary, created_at)   -- kind: morning | evening
ALTER TABLE user_tasks ADD COLUMN goal_id TEXT;
```

`briefings` 用来保证每天每种简报只生成一次：cron 重载、休眠唤醒或手动触发都先查当天记录，已存在则不重复生成。

### 1.2 承诺从哪里来

- **助理创建提醒时**自动写一条 `owner = assistant, status = open` 的承诺，指向该提醒；提醒触发并弹窗后记 `done`。这条链路不需要确认，因为提醒本身已经过确认。
- **对话中的用户承诺**由记忆提取的同一后台任务识别，写入 `status = proposed`，不自动建待办。下一轮聊天或次日简报里以一句话确认（"我记下了你周五要交报告，要加进待办吗？"），确认后转 `open` 并创建待办；拒绝转 `cancelled`。这和记忆候选的 `pending / confirmed / rejected` 是同一套纪律：不把低置信内容直接变成事实。
- **用户明说的**（"帮我记住我答应周五交报告"）直接 `open`，走 `manage_commitments` 工具。

### 1.3 状态推进规则

- 待办改为 `done` 时，关联承诺自动 `done`，`evidence_run_id` 记录那次 run。
- 承诺过了 `due_at` 仍 `open` → 晚间复盘标为 `missed`，不自动顺延；顺延必须由用户在复盘中决定。
- 目标下所有待办与承诺关闭后，晚间复盘询问是否把目标标为 `done`，不自动关闭。

---

## 2. 每日管家闭环

一天两次固定触发，都走现有 `scheduled_tasks` 的 `agent_prompt` 类型，在当前活跃会话中运行，回复持久化为一条助理消息，同时弹一条提醒作为入口。

### 2.1 早间简报（默认 08:00）

数据来源全部是现有或新增的只读工具，模型只负责组织语言和提出建议：

| 内容 | 来源 |
|---|---|
| 天气 | `weather`，城市取自用户画像 `user.city`；缺失则跳过并在简报末尾问一次 |
| 今日与逾期待办 | `user_tasks` 按 `due_at <= 今天` 与 `status in (pending, in_progress)` |
| 今日提醒 | `scheduled_tasks` 中今天会触发的条目 |
| 到期承诺 | `commitments` 中 `due_at <= 今天 + 2 天` 且 `open` |
| 待确认承诺 | `status = proposed` 的条目，最多 3 条 |
| 目标进度 | 每个 `active` 目标下待办完成数 / 总数 |

这些由一个只读聚合工具 `build_daily_brief` 一次返回结构化文本，避免模型串行调六个工具耗尽轮次。

用户回复调整（"把报告推到下周一""今天不用提醒我健身"）后，模型调用 `update_user_task`、`manage_commitments`、`delete_scheduled_task` 真正写入，每一步都进 `task_runs`。

### 2.2 晚间复盘（默认 21:30）

`build_evening_review` 返回：今日完成的待办、未完成的待办、今天 `missed` 的承诺、今天所有 run 的产物清单。模型据此：

1. 逐项确认未完成项是顺延、取消还是继续。
2. 对每条"已完成"引用产物或工具结果；没有证据的不能标完成。
3. 只提取少量高价值记忆候选（沿用 S5 的策略，`companion` 模式不提取）。

### 2.3 主动性边界

- 两次简报都是用户在设置里显式开启的，按 `scheduled_reminder, explicit = true` 走现有 `proactivity` 策略：安静时段内推迟到时段结束，关闭开关则不生成。
- 简报本身不发送任何外部内容，不修改任何文件；所有写操作都由用户在对话里确认后发生。
- 同一天不重复生成；`briefings` 表是幂等键。

---

## 3. 需要新增的东西

| 层 | 新增 | 说明 |
|---|---|---|
| 数据 | migration 0022、`repositories/goals.ts`、`repositories/commitments.ts`、`repositories/briefings.ts` | 双引擎测试，沿用 `task-runs` 的写法 |
| 工具 | `manage_goals`、`manage_commitments` | 各自 `action` 复用一个工具，用 `describeCall` 把 list 标为只读 |
| 工具 | `build_daily_brief`、`build_evening_review` | 只读聚合，`READ_ONLY_CONTRACT` |
| 联动 | `create_scheduled_task` 成功后写助理承诺；`update_user_task` 改为 done 时关闭关联承诺 | 在工具内完成，不依赖模型记得做 |
| 提取 | 记忆提取任务中增加承诺候选识别 | 输出 `proposed` 承诺，不建待办 |
| 技能 | `daily-steward` 技能包 | 早间/晚间两段流程提示，要求引用证据 |
| 设置 | 定时任务页新增"每日管家"开关与两个时间 | 保存时以固定 idempotency key 创建/更新两条 `agent_prompt` 任务 |
| 界面 | 聊天里展示"上次运行中断"与简报卡片 | 简报卡片可先用普通消息，卡片化留后 |

不做：外部日历/邮件（已从产品路线取消）、主动收件箱（留给 P3）、自动顺延承诺、自动关闭目标。

---

## 4. 实施顺序与验收

1. **数据与工具**（先做）：0022 migration、三个仓库、`manage_goals` / `manage_commitments`、提醒与待办的联动。验收：创建提醒后能查到助理承诺；待办完成后承诺自动关闭并带 run 证据；双引擎测试通过。
2. **聚合工具与技能**：`build_daily_brief` / `build_evening_review`、`daily-steward` 技能。验收：离线固定数据集上，简报包含全部六类内容且顺序稳定；复盘对每条"已完成"都能指出证据。
3. **调度与设置**：设置页开关、两条系统任务、`briefings` 幂等。验收：手动把时间设到一分钟后，弹窗与助理消息各出现一次；重启应用后不重复生成；安静时段内推迟。
4. **承诺提取**：后台提取 `proposed` 承诺，简报里确认。验收：三段固定对话样本各提取出预期承诺且都是 `proposed`；拒绝后不再提出同一条。
5. **真实使用一周**：记录每天简报是否准确、是否打扰、是否漏跟进，作为 P0 完成证据。

P0 的完成证据仍按蓝图：中途退出后仍能继续（已落地）；任何"已完成"都有工具结果或产物（复盘环节强制）。

---

## 5. 已确认的决定（2026-09-13）

1. 用户承诺必须挂一条待办；没有就自动创建。
2. 对话中识别的承诺默认 `proposed`，确认后才生效。
3. 默认 08:00 / 21:30；简报落在当前会话，同时弹标题提醒，弹窗做成设置项。
4. 天气城市从用户画像 `user.city` 取，没有则在简报里问一次。

## 6. 进度

- **工程与自动化状态：已收口。** 数据、工具、技能、调度、设置和承诺提取均已实现；`pnpm test:p0`、类型检查和生产构建通过，真实 native 数据库已完成 0021/0022 迁移。
- **第 1 步 数据与工具：已完成。** migration 0022、`goals` / `commitments` / `briefings` 三个仓库、`manage_goals` 与 `manage_commitments` 工具；创建提醒自动记录助理承诺，一次性提醒弹出后自动完成，删除提醒自动取消；待办改为 done / cancelled / 重新打开时同步承诺并记录 run 证据；承诺完成时关联待办同步完成。固定入口 `pnpm test:p0`。
- **第 2 步 聚合工具与技能：已完成。** `build_daily_brief` / `build_evening_review` 只读聚合（唯一写操作是 `briefings` 幂等记录与到期承诺标 missed），每天每种只生成一次，`force=true` 才重做；`skills/daily-steward/SKILL.md` 固定早晚两条流程，要求确认后才写入、已完成必须有证据。
- **第 3 步 调度与设置：已完成。** 设置 → 定时任务 新增"每日管家"面板（开关、早晚时间、是否弹窗）；保存时按标记幂等创建/更新两条 `agent_prompt` 系统任务，关闭只停用不删除；应用启动会补齐缺失任务。系统任务声明 `respect_quiet_hours`，安静时段内推迟到时段结束；成功生成后弹标题提醒，失败或主动性关闭时不弹。
- **第 4 步 承诺提取：已完成。** 复用记忆提取的同一次模型调用，提示词额外要求以 `type: commitment` 输出用户明确答应的事；置信度低于 0.6 不入队，同标题 30 天内已存在（含用户已取消的）不重复提出；只写 `proposed`，不建待办；候选写入失败不影响记忆提取。`companion` 模式不提取。
- **第 5 步 真实使用一周：未开始。** 这是 P0 剩余的产品验收，不是缺失的工程功能。需要在真实应用里开启每日管家，记录每天简报是否准确、是否打扰、是否漏跟进，并覆盖重启、安静时段和同日不重复生成。
