import { describe, expect, it } from 'vitest';
import { parseSubmissionRequest, parseToolDraftItems } from '../erp-tools';

describe('ERP Agent tools', () => {
  it('normalizes decimal hours and records the real source message id', () => {
    const items = parseToolDraftItems([{
      item_id: 'aps', task_id: '1001', task_name: 'APS 自动排产系统调整', project_name: '光拓智能日常',
      work_hours: 3.5, work_content: '调整排产算法，修复扫描问题。', duration_estimated: false,
    }], 'message-current');
    expect(items[0]).toMatchObject({ itemId: 'aps', taskId: '1001', workMinutes: 210, sourceMessageIds: ['message-current'] });
  });

  it('preserves earlier sources when a stable item is revised', () => {
    const previous = parseToolDraftItems([{
      item_id: 'aps', task_id: '1001', task_name: 'APS 自动排产系统调整', work_hours: 3.5, work_content: '初稿',
    }], 'message-1');
    const revised = parseToolDraftItems([{
      item_id: 'aps', task_id: '1001', task_name: 'APS 自动排产系统调整', work_hours: 4, work_content: '调整后的内容',
    }], 'message-2', previous);
    expect(revised[0]).toMatchObject({ itemId: 'aps', workMinutes: 240, sourceMessageIds: ['message-1', 'message-2'] });
  });

  it('rejects unsupported precision instead of rounding', () => {
    expect(() => parseToolDraftItems([{
      task_name: 'APS', work_hours: 0.51, work_content: '测试',
    }], 'message-1')).toThrow('最多保留一位小数');
  });

  it('accepts a batch id only as a separate resume request', () => {
    const batchId = '12345678-1234-1234-1234-123456789abc';
    expect(parseSubmissionRequest({ batch_id: batchId })).toEqual({ batchId, allowPossibleDuplicate: false });
    expect(() => parseSubmissionRequest({ batch_id: batchId, draft_revision: 1 })).toThrow('不能与草稿参数同时使用');
    expect(() => parseSubmissionRequest({})).toThrow('draft_id 无效');
  });
});
