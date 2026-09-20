export type RunErrorCategory =
  | 'controlled_stop'
  | 'cancelled'
  | 'timeout'
  | 'permission_denied'
  | 'configuration'
  | 'rate_limited'
  | 'network'
  | 'persistence'
  | 'tool'
  | 'internal';

export function classifyRunError(message: string): RunErrorCategory {
  if (/本段.*预算|尚未收到必要回答|已停止重复尝试|结果未知|模型输出达到长度上限|完整模型输入达到上下文预算/.test(message)) return 'controlled_stop';
  if (/取消|cancel|abort/i.test(message)) return 'cancelled';
  if (/超时|timeout|timed out/i.test(message)) return 'timeout';
  if (/权限.*拒绝|拒绝.*操作|permission.*denied/i.test(message)) return 'permission_denied';
  if (/api key|未配置|配置.*模型|configuration|invalid.*key/i.test(message)) return 'configuration';
  if (/429|请求过于频繁|额度不足|限流|rate.?limit/i.test(message)) return 'rate_limited';
  if (/数据库|持久化|sqlite|migration/i.test(message)) return 'persistence';
  if (/网络|network|fetch|连接|econn|http\s*\d{3}/i.test(message)) return 'network';
  if (/工具|tool|mcp/i.test(message)) return 'tool';
  return 'internal';
}

export function getRunRecoveryAdvice(category: RunErrorCategory): string | null {
  switch (category) {
    case 'controlled_stop':
      return '先核对阶段摘要和已有产物，再确认剩余工作；重新发送会启动新运行，不会自动从断点续跑。';
    case 'cancelled':
      return null;
    case 'timeout':
      return '请稍后重试；若持续发生，请检查模型服务或相关工具是否可用。';
    case 'permission_denied':
      return '操作未执行。确认权限策略后重新发起即可。';
    case 'configuration':
      return '请检查设置中的 API Key、服务地址和模型名称。';
    case 'rate_limited':
      return '模型服务当前限流或额度不足，请稍后重试并检查账户额度。';
    case 'network':
      return '请检查网络连接和服务地址，然后重试。';
    case 'persistence':
      return '请先运行数据库健康检查，确认数据库可写后再重试。';
    case 'tool':
      return '可重试此操作，或换一种不依赖该工具的方式。';
    case 'internal':
      return '请重试；若重复发生，可使用运行编号查看诊断记录。';
  }
}

export function formatRunErrorForUser(message: string, runId?: string): string {
  const category = classifyRunError(message);
  if (category === 'cancelled') return '已取消';

  const advice = getRunRecoveryAdvice(category);
  return [
    message.trim() || '运行失败',
    advice ? `建议：${advice}` : '',
    runId ? `运行编号：${runId}` : '',
  ].filter(Boolean).join('\n');
}
