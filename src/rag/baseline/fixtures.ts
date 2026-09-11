export interface RetrievalBaselineDocument {
  filename: string;
  content: string;
}

export interface RetrievalBaselineCase {
  id: string;
  question: string;
  expectedSource: string;
  expectedFacts: string[];
}

export const RETRIEVAL_BASELINE_DOCUMENTS: RetrievalBaselineDocument[] = [
  {
    filename: 'account-guide.md',
    content: [
      '# 账户手册',
      '连续登录失败 5 次后，账户锁定 30 分钟。',
      '密码重置链接的有效期是 24 小时。',
      '启用双因素认证时会生成 10 个恢复码。',
    ].join('\n'),
  },
  {
    filename: 'release-process.md',
    content: [
      '# 发布流程',
      '常规生产发布窗口是每周三 20:00。',
      '代码冻结时间是每周二 18:00。',
      '出现严重故障时，回滚必须在 15 分钟内开始。',
    ].join('\n'),
  },
  {
    filename: 'expense-policy.md',
    content: [
      '# 报销政策',
      '国内出差住宿标准上限为每晚 600 元。',
      '出租车费用超过 50 元必须提供发票。',
      '报销单应在行程结束后 5 个工作日内提交。',
    ].join('\n'),
  },
  {
    filename: 'data-retention.md',
    content: [
      '# 数据保留规则',
      '应用访问日志保留 30 天。',
      '数据库备份保留 90 天。',
      '用户提出删除请求后，应在 7 天内完成数据清除。',
    ].join('\n'),
  },
];

export const RETRIEVAL_BASELINE_CASES: RetrievalBaselineCase[] = [
  { id: 'account-lock', question: '连续登录失败多少次会锁定，锁多久？', expectedSource: 'account-guide.md', expectedFacts: ['5 次', '30 分钟'] },
  { id: 'password-reset', question: '密码重置链接有效期多长？', expectedSource: 'account-guide.md', expectedFacts: ['24 小时'] },
  { id: 'mfa-codes', question: '双因素认证会生成几个恢复码？', expectedSource: 'account-guide.md', expectedFacts: ['10 个'] },
  { id: 'release-window', question: '常规生产发布窗口是什么时间？', expectedSource: 'release-process.md', expectedFacts: ['每周三', '20:00'] },
  { id: 'code-freeze', question: '每周什么时候代码冻结？', expectedSource: 'release-process.md', expectedFacts: ['每周二', '18:00'] },
  { id: 'rollback-time', question: '严重故障后要求多久开始回滚？', expectedSource: 'release-process.md', expectedFacts: ['15 分钟'] },
  { id: 'hotel-limit', question: '国内出差每晚住宿上限是多少？', expectedSource: 'expense-policy.md', expectedFacts: ['600 元'] },
  { id: 'taxi-receipt', question: '出租车费用超过多少必须提供发票？', expectedSource: 'expense-policy.md', expectedFacts: ['50 元'] },
  { id: 'expense-deadline', question: '行程结束后多久要提交报销单？', expectedSource: 'expense-policy.md', expectedFacts: ['5 个工作日'] },
  { id: 'access-log-retention', question: '应用访问日志保留多久？', expectedSource: 'data-retention.md', expectedFacts: ['30 天'] },
  { id: 'backup-retention', question: '数据库备份的保留周期是多少？', expectedSource: 'data-retention.md', expectedFacts: ['90 天'] },
  { id: 'deletion-sla', question: '用户要求删除数据后几天内要完成？', expectedSource: 'data-retention.md', expectedFacts: ['7 天'] },
];
