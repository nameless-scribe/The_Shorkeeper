---
name: erp-work-report
description: 把用户自由描述的当天工作整理为 ERP 报工草稿，匹配真实任务，核对本人当天工时，并通过专用浏览器连接 ERP
metadata:
  shorekeeper:
    displayName: ERP 报工
    version: 0.1.1
    trigger: auto
    kind: workflow
    matchKeywords: [报工, 工时填报, 填工时, ERP报工, 实际工时]
    priority: 30
    allowedTools: [connect_erp, read_erp_context, prepare_erp_report, submit_erp_report, reconcile_erp_report, ask_user, recall_memory]
    requiredTools: [connect_erp, read_erp_context, prepare_erp_report, submit_erp_report, reconcile_erp_report]
---

【技能：ERP 报工】

用户可以自由描述，不要求固定格式。先把日期、任务线索、明确工时和工作内容整理出来；缺失或歧义只问影响正确填报的部分，不能猜工时、平均分配总时长或补满 8 小时。

1. 日期展开成明确的 `YYYY-MM-DD`。今天按当前 Asia/Shanghai 日期解释；跨日后不能静默替换旧草稿日期。
2. 先调用 `connect_erp`。已配置账号密码和看图能力时，专用浏览器会尝试自动识别算术验证码并登录；工具提示人工接管时，再请用户在可见窗口核对验证码并登录。不要索要或复述密码、验证码。
3. 登录后用 `read_erp_context` 读取本人身份、当天已有报工和任务候选。任务线索不够就带更具体的 `query` 重查；多个候选时用 `ask_user`，只有唯一匹配才写入真实 `task_id`。
4. 用 `prepare_erp_report` 保存草稿。该工具会重新读取 ERP，验证任务身份、当天 8 小时额度和可能重复记录。工时传小数小时；不明确就传 `null`，带“大约”等估计含义时 `duration_estimated=true`。工作内容可润色，但不能增加用户未说的成果、数量或事项。
5. 工具提示可能重复时，先把已有记录告诉用户并询问；只有用户明确仍要新增，才在下一次调用设置 `allow_possible_duplicate=true`。
6. 后续“改成四小时”“采购先不报”必须修改原 `draft_id`，带当前 `expected_revision` 和原 `item_id`；不要创建重复草稿条目。
7. 只有用户明确要求提交已经整理好的草稿时才调用 `submit_erp_report(draft_id, draft_revision)`。该工具会先生成最终业务预览；用户在可信确认弹窗批准后才逐条新增，并以回查到唯一新记录作为完成证据。用户拒绝、预览过期、审批或账本写入失败时不得重试或改用通用点击。
8. `submit_erp_report` 返回 `outcome_unknown` 和 `batchId` 时，先调用 `reconcile_erp_report` 只读回查，不能自动再次提交。若批次只完成一部分且没有结果未知条目，只有用户明确要求继续，才用 `submit_erp_report(batch_id)` 预览剩余条目并取得新的可信确认。已核验条目不再发送；仍有结果未知时继续停下核对。只有提交或回查工具说明全部条目已核验，才能告诉用户整批报工完成。
