import { extractSearchTerms, scoreChunkForTerms } from '../sparse-search';
import {
  RETRIEVAL_BASELINE_CASES,
  RETRIEVAL_BASELINE_DOCUMENTS,
  type RetrievalBaselineCase,
  type RetrievalBaselineDocument,
} from './fixtures';

export type RetrievalBaselineMode = 'catalog' | 'auto' | 'tool';
export type RetrievalBaselineImplementation = 'offline_sparse_proxy';

export interface RetrievalBaselineCaseResult {
  id: string;
  mode: RetrievalBaselineMode;
  recalledSources: string[];
  sourceHit: boolean;
  answer: string | null;
  factCoverage: number | null;
  citationHit: boolean | null;
}

export interface RetrievalBaselineModeResult {
  mode: RetrievalBaselineMode;
  implementation: RetrievalBaselineImplementation;
  productionPathVerified: false;
  caseCount: number;
  sourceRecall: number;
  averageFactCoverage: number | null;
  citationRate: number | null;
  cases: RetrievalBaselineCaseResult[];
}

function normalizeFactText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
}

function rankDocuments(
  question: string,
  documents: RetrievalBaselineDocument[],
  limit = 3,
): RetrievalBaselineDocument[] {
  const terms = extractSearchTerms(question);
  return documents
    .map((document) => ({
      document,
      score: scoreChunkForTerms(document.content, document.filename, terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.document.filename.localeCompare(b.document.filename))
    .slice(0, limit)
    .map((item) => item.document);
}

function evaluateCase(
  baselineCase: RetrievalBaselineCase,
  mode: RetrievalBaselineMode,
  documents: RetrievalBaselineDocument[],
): RetrievalBaselineCaseResult {
  const recalled = mode === 'catalog' ? documents : rankDocuments(baselineCase.question, documents);
  const sourceHit = recalled.some((document) => document.filename === baselineCase.expectedSource);
  if (mode === 'catalog') {
    return {
      id: baselineCase.id,
      mode,
      recalledSources: recalled.map((document) => document.filename),
      sourceHit,
      answer: null,
      factCoverage: null,
      citationHit: null,
    };
  }

  const top = recalled[0];
  const answer = top ? `${top.content}\n\n来源：${top.filename}` : '';
  const normalizedAnswer = normalizeFactText(answer);
  const matchedFacts = baselineCase.expectedFacts.filter((fact) =>
    normalizedAnswer.includes(normalizeFactText(fact)),
  );
  return {
    id: baselineCase.id,
    mode,
    recalledSources: recalled.map((document) => document.filename),
    sourceHit,
    answer,
    factCoverage: baselineCase.expectedFacts.length
      ? matchedFacts.length / baselineCase.expectedFacts.length
      : 1,
    citationHit: answer.includes(baselineCase.expectedSource),
  };
}

export function runRetrievalBaseline(
  modes: RetrievalBaselineMode[] = ['catalog', 'auto', 'tool'],
  cases = RETRIEVAL_BASELINE_CASES,
  documents = RETRIEVAL_BASELINE_DOCUMENTS,
): RetrievalBaselineModeResult[] {
  return modes.map((mode) => {
    const results = cases.map((baselineCase) => evaluateCase(baselineCase, mode, documents));
    const answered = results.filter(
      (result): result is RetrievalBaselineCaseResult & {
        factCoverage: number;
        citationHit: boolean;
      } => result.factCoverage != null && result.citationHit != null,
    );
    return {
      mode,
      implementation: 'offline_sparse_proxy',
      productionPathVerified: false,
      caseCount: results.length,
      sourceRecall: results.filter((result) => result.sourceHit).length / results.length,
      averageFactCoverage: answered.length
        ? answered.reduce((sum, result) => sum + result.factCoverage, 0) / answered.length
        : null,
      citationRate: answered.length
        ? answered.filter((result) => result.citationHit).length / answered.length
        : null,
      cases: results,
    };
  });
}
