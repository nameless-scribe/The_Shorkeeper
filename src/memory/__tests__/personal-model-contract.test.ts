import { describe, expect, it } from 'vitest';
import {
  MEMORY_MODEL_USE_POLICIES,
  MEMORY_PROPOSED_ACTIONS,
  MEMORY_SENSITIVITIES,
  PERSONAL_MEMORY_STATUSES,
  PERSONAL_MEMORY_TYPES,
  classifyPersonalMemoryKey,
} from '../personal-model';
import { P1_PERSONAL_MODEL_FIXTURES } from './fixtures/p1-personal-model';

describe('P1.0 personal model contract', () => {
  it('keeps the public vocabulary closed and explicit', () => {
    expect(PERSONAL_MEMORY_TYPES).toEqual([
      'identity', 'preference', 'relationship', 'event',
      'goal', 'habit', 'procedure', 'other',
    ]);
    expect(PERSONAL_MEMORY_STATUSES).toEqual([
      'active', 'disputed', 'superseded', 'expired', 'rejected',
    ]);
    expect(MEMORY_SENSITIVITIES).toEqual(['normal', 'private', 'sensitive']);
    expect(MEMORY_MODEL_USE_POLICIES).toEqual(['allow', 'deny']);
    expect(MEMORY_PROPOSED_ACTIONS).toEqual(['create', 'replace', 'merge', 'ignore']);
  });

  it('classifies every frozen key without depending on model output', () => {
    for (const fixture of P1_PERSONAL_MODEL_FIXTURES) {
      expect(classifyPersonalMemoryKey(fixture.memoryKey), fixture.id)
        .toBe(fixture.expectedType);
    }
  });

  it('never permits sensitive fixture content to enter model context by default', () => {
    const sensitive = P1_PERSONAL_MODEL_FIXTURES.filter(
      (fixture) => fixture.expectedSensitivity === 'sensitive',
    );
    expect(sensitive.length).toBeGreaterThan(0);
    expect(sensitive.every((fixture) => fixture.expectedModelUsePolicy === 'deny')).toBe(true);
  });

  it('requires confirmation for replacements and rejects credential capture', () => {
    const replacement = P1_PERSONAL_MODEL_FIXTURES.find(
      (fixture) => fixture.expectedAction === 'replace',
    );
    const credential = P1_PERSONAL_MODEL_FIXTURES.find(
      (fixture) => fixture.id === 'credential-denied',
    );
    expect(replacement?.expectedDecision).toBe('confirm');
    expect(credential).toMatchObject({
      expectedAction: 'ignore',
      expectedDecision: 'deny',
      expectedModelUsePolicy: 'deny',
    });
  });
});
