export type SpeechPlanStep =
  | { type: 'pause'; ms: number }
  | { type: 'speak'; text: string };

type RawSegment =
  | { type: 'action'; text: string }
  | { type: 'dialogue'; text: string };

/** Pause length after RP action before the next dialogue line. */
export function actionPauseDurationMs(actionText: string): number {
  const len = actionText.replace(/\s+/g, '').length;
  return Math.min(4500, Math.max(1500, 1200 + len * 45));
}

function prepareTextForSegmentParsing(text: string): string {
  let s = text.trim();
  if (!s) return '';

  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`]+`/g, ' ');
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  s = s.replace(/<[^>]+>/g, ' ');

  return s;
}

function cleanDialogueSegment(text: string): string {
  let s = text.trim();
  if (!s) return '';

  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/_{1,2}([^_]+)_{1,2}/g, '$1');
  s = s.replace(/\|/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

export function parseRoleplaySpeechSegments(text: string): RawSegment[] {
  let prepared = prepareTextForSegmentParsing(text);
  if (!prepared) return [];
  prepared = prepared.replace(/\*\*([^*]+)\*\*/g, '$1');

  const segments: RawSegment[] = [];
  const regex = /\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(prepared)) !== null) {
    const dialogueBefore = prepared.slice(lastIndex, match.index).trim();
    if (dialogueBefore) {
      segments.push({ type: 'dialogue', text: dialogueBefore });
    }
    segments.push({ type: 'action', text: match[1].trim() });
    lastIndex = regex.lastIndex;
  }

  const tail = prepared.slice(lastIndex).trim();
  if (tail) {
    segments.push({ type: 'dialogue', text: tail });
  }

  return segments.filter((seg) => seg.text.length > 0);
}

export function planSpeechFromMessage(text: string, maxChars: number): SpeechPlanStep[] {
  const segments = parseRoleplaySpeechSegments(text);
  const steps: SpeechPlanStep[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'action') {
      let j = i;
      let pauseMs = 0;
      while (j < segments.length && segments[j].type === 'action') {
        pauseMs = Math.min(6000, pauseMs + actionPauseDurationMs(segments[j].text));
        j++;
      }
      if (segments[j]?.type === 'dialogue') {
        steps.push({ type: 'pause', ms: pauseMs });
        i = j - 1;
      }
      continue;
    }

    const cleaned = cleanDialogueSegment(seg.text);
    if (cleaned) {
      steps.push({ type: 'speak', text: cleaned });
    }
  }

  return truncateSpeechPlan(steps, maxChars);
}

function splitBySentence(text: string): string[] {
  const out: string[] = [];
  let current = '';

  for (const char of text) {
    current += char;
    if (/[。！？!?…]/.test(char) || char === '\n') {
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = '';
    }
  }

  const tail = current.trim();
  if (tail) out.push(tail);
  return out;
}

/** Split long dialogue into sentence-sized TTS chunks for faster time-to-first-audio. */
export function splitDialogueIntoChunks(text: string, maxLen = 500): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentences = splitBySentence(trimmed);
  if (sentences.length === 0) return [trimmed];

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxLen) {
      chunks.push(sentence);
      continue;
    }
    for (let i = 0; i < sentence.length; i += maxLen) {
      chunks.push(sentence.slice(i, i + maxLen));
    }
  }

  return chunks;
}

export function expandPlanForStreaming(plan: SpeechPlanStep[]): SpeechPlanStep[] {
  const expanded: SpeechPlanStep[] = [];
  for (const step of plan) {
    if (step.type === 'pause') {
      expanded.push(step);
      continue;
    }
    for (const chunk of splitDialogueIntoChunks(step.text)) {
      expanded.push({ type: 'speak', text: chunk });
    }
  }
  return expanded;
}

export function planStreamingSpeechFromMessage(text: string, maxChars: number): SpeechPlanStep[] {
  return expandPlanForStreaming(planSpeechFromMessage(text, maxChars));
}

function truncateSpeechPlan(steps: SpeechPlanStep[], maxChars: number): SpeechPlanStep[] {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return steps;

  let remaining = maxChars;
  const out: SpeechPlanStep[] = [];

  for (const step of steps) {
    if (step.type === 'pause') {
      out.push(step);
      continue;
    }
    if (remaining <= 0) break;

    if (step.text.length <= remaining) {
      out.push(step);
      remaining -= step.text.length;
      continue;
    }

    out.push({ type: 'speak', text: `${step.text.slice(0, remaining)}…` });
    break;
  }

  return out;
}

/** Strip markdown / tool noise before TTS (dialogue only, no pauses). */
export function stripMarkdownForSpeech(text: string): string {
  return planSpeechFromMessage(text, Number.POSITIVE_INFINITY)
    .filter((step): step is Extract<SpeechPlanStep, { type: 'speak' }> => step.type === 'speak')
    .map((step) => step.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateForSpeech(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

export function hasSpeakableDialogue(text: string): boolean {
  return stripMarkdownForSpeech(text).length > 0;
}
