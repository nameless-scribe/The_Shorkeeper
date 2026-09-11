import { runRetrievalBaseline } from '../src/rag/baseline/evaluator';

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  results: runRetrievalBaseline(),
}, null, 2));
