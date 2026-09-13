import type {
  MemoryCandidateDecision,
  MemoryModelUsePolicy,
  MemoryProposedAction,
  MemorySensitivity,
  PersonalMemoryType,
} from '../../../shared/types';

export interface P1PersonalModelFixture {
  id: string;
  utterance: string;
  memoryKey: string;
  expectedType: PersonalMemoryType;
  expectedSensitivity: MemorySensitivity;
  expectedModelUsePolicy: MemoryModelUsePolicy;
  expectedAction: MemoryProposedAction;
  expectedDecision: MemoryCandidateDecision;
}

/** P1.0 frozen examples: later extraction/policy work must keep these outcomes compatible. */
export const P1_PERSONAL_MODEL_FIXTURES: readonly P1PersonalModelFixture[] = [
  {
    id: 'explicit-identity',
    utterance: '以后叫我小汐。',
    memoryKey: 'user.nickname',
    expectedType: 'identity',
    expectedSensitivity: 'normal',
    expectedModelUsePolicy: 'allow',
    expectedAction: 'create',
    expectedDecision: 'confirm',
  },
  {
    id: 'stable-preference',
    utterance: '我一直更喜欢低糖拿铁。',
    memoryKey: 'user.preference.drink',
    expectedType: 'preference',
    expectedSensitivity: 'normal',
    expectedModelUsePolicy: 'allow',
    expectedAction: 'create',
    expectedDecision: 'silent',
  },
  {
    id: 'preference-conflict',
    utterance: '我现在不喝咖啡了，改喝茶。',
    memoryKey: 'user.preference.drink',
    expectedType: 'preference',
    expectedSensitivity: 'normal',
    expectedModelUsePolicy: 'allow',
    expectedAction: 'replace',
    expectedDecision: 'confirm',
  },
  {
    id: 'relationship-private',
    utterance: '阿澈是我的伴侣。',
    memoryKey: 'user.relationship.partner',
    expectedType: 'relationship',
    expectedSensitivity: 'private',
    expectedModelUsePolicy: 'allow',
    expectedAction: 'create',
    expectedDecision: 'confirm',
  },
  {
    id: 'temporary-event',
    utterance: '我下周三要去杭州出差。',
    memoryKey: 'user.event.hangzhou_trip',
    expectedType: 'event',
    expectedSensitivity: 'private',
    expectedModelUsePolicy: 'allow',
    expectedAction: 'create',
    expectedDecision: 'confirm',
  },
  {
    id: 'goal-routed',
    utterance: '我想在年底前完成产品发布。',
    memoryKey: 'user.goal.product_launch',
    expectedType: 'goal',
    expectedSensitivity: 'normal',
    expectedModelUsePolicy: 'allow',
    expectedAction: 'create',
    expectedDecision: 'confirm',
  },
  {
    id: 'habit',
    utterance: '我每个工作日早上七点跑步。',
    memoryKey: 'user.habit.morning_run',
    expectedType: 'habit',
    expectedSensitivity: 'normal',
    expectedModelUsePolicy: 'allow',
    expectedAction: 'create',
    expectedDecision: 'silent',
  },
  {
    id: 'sensitive-health',
    utterance: '我正在接受一项长期治疗。',
    memoryKey: 'user.procedure.health_treatment',
    expectedType: 'procedure',
    expectedSensitivity: 'sensitive',
    expectedModelUsePolicy: 'deny',
    expectedAction: 'create',
    expectedDecision: 'confirm',
  },
  {
    id: 'credential-denied',
    utterance: '我的银行卡密码是 123456。',
    memoryKey: 'user.other.bank_password',
    expectedType: 'other',
    expectedSensitivity: 'sensitive',
    expectedModelUsePolicy: 'deny',
    expectedAction: 'ignore',
    expectedDecision: 'deny',
  },
] as const;
