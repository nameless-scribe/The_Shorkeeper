import { beforeEach, describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../../tools/builtin';
import { discoverSkills, invalidateSkillsCache } from '../loader';
import { resolveActiveSkills } from '../resolve';

describe('product skill contracts', () => {
  beforeEach(() => invalidateSkillsCache());

  it('keeps product skills valid and their required tools available', () => {
    const tools = new Set(createBuiltinRegistry().list().map((tool) => tool.name));
    const productSkills = discoverSkills().filter((skill) => skill.kind !== 'internal');

    expect(productSkills.map((skill) => skill.id).sort()).toEqual([
      'daily-steward',
      'data-query',
      'doc-compose',
      'doc-to-markdown',
      'erp-work-report',
      'excel',
      'image-qa',
      'meeting-notes',
      'progress-tracker',
      'task-execution',
      'workspace-doc-edit',
    ]);
    for (const skill of productSkills) {
      expect(skill.validationErrors, skill.id).toEqual([]);
      for (const tool of skill.requiredTools ?? []) {
        expect(tools.has(tool), `${skill.id} requires missing tool ${tool}`).toBe(true);
      }
      for (const tool of skill.allowedTools ?? []) {
        expect(tools.has(tool), `${skill.id} allows missing tool ${tool}`).toBe(true);
      }
    }
  });

  it('activates ERP reporting only for reporting intent', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const ids = (message: string) => resolveActiveSkills(message, skills).map((skill) => skill.id);
    expect(ids('今天 APS 做了三个半小时，帮我整理报工')).toContain('erp-work-report');
    expect(ids('今天 APS 做了三个半小时，帮我整理报工')).not.toContain('data-query');
    expect(ids('今天做了晚饭，味道不错')).not.toContain('erp-work-report');
  });

  it('does not activate task tracking for an unrelated spreadsheet attachment', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const active = resolveActiveSkills(
      '[用户已上传以下文件到工作区]\n- sales.xlsx → 工作区: sales.xlsx\n\n帮我统计销售额' +
        '\n\n[工作区附件已解析]\n文件: sales.xlsx',
      skills,
    );
    expect(active.map((skill) => skill.id)).toContain('excel');
    expect(active.map((skill) => skill.id)).not.toContain('progress-tracker');
  });

  it('does not activate multi-step execution for generic analysis wording', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const active = resolveActiveSkills('分析一下这段话', skills);
    expect(active.map((skill) => skill.id)).not.toContain('task-execution');
  });

  it('activates meeting notes for recording wording and stays quiet for ordinary meeting talk', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const ids = (message: string) => resolveActiveSkills(message, skills).map((skill) => skill.id);

    expect(ids('帮我把 测试会议.wav 整理成会议纪要')).toContain('meeting-notes');
    expect(ids('把 测试会议.wav 转写成逐字稿')).toContain('meeting-notes');
    expect(ids('总结这段录音里定了哪些事')).toContain('meeting-notes');
    // 只是聊到开会，不该把录音流程拉进来
    expect(ids('明天下午三点的会议室帮我订一下')).not.toContain('meeting-notes');
    // 附件介绍行本身不能替用户决定要不要出纪要：只上传录音、没说要干嘛，不激活
    expect(ids(
      '[用户已上传以下文件到工作区]\n- 周会.m4a → 工作区: 周会.m4a（1 字节，这是录音文件，需要文字内容时用 transcribe_audio 生成文稿，不要用 read_file 读取）\n\n这个先放着',
    )).not.toContain('meeting-notes');
    expect(ids('今天要做什么')).not.toContain('meeting-notes');
  });

  it('routes Word edits to workspace-doc-edit rather than doc-compose or a bare conversion', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const ids = (message: string) => resolveActiveSkills(message, skills).map((skill) => skill.id);

    expect(ids('把 合同.docx 里第三段的日期改成 9 月 30 日')).toContain('workspace-doc-edit');
    expect(ids('帮我改一下这份 word 里的联系人')).toContain('workspace-doc-edit');
    expect(ids('把 合同.docx 里第三段的日期改成 9 月 30 日')).not.toContain('doc-compose');
    expect(ids('把 报价.docx 转 markdown')).not.toContain('workspace-doc-edit');
    expect(ids('把回答改成英文')).not.toContain('workspace-doc-edit');
  });

  it('activates doc-compose for writing requests without stealing conversions or edits', () => {
    const skills = discoverSkills().filter((skill) => skill.kind !== 'internal');
    const ids = (message: string) => resolveActiveSkills(message, skills).map((skill) => skill.id);

    expect(ids('帮我把这些想法整理成一份方案')).toContain('doc-compose');
    expect(ids('写一份下季度的推广计划，生成 Word')).toContain('doc-compose');
    expect(ids('做成 PDF 发给客户')).toContain('doc-compose');
    // 转换与原位编辑是别的技能的事
    expect(ids('把 报价.docx 转 markdown')).not.toContain('doc-compose');
    expect(ids('修改文档里的第三段')).not.toContain('doc-compose');
    expect(ids('帮我把 周会.m4a 整理成会议纪要')).not.toContain('doc-compose');
  });

  it('keeps internal example skills out of prompt formatting and activation', () => {
    const example = discoverSkills().find((skill) => skill.id === 'example');
    expect(example?.kind).toBe('internal');
    expect(resolveActiveSkills('你好', example ? [example] : [])).toEqual([]);
  });
});
