import { AI_KINDS } from './runtime.js';

export function createMockTransport({ latencyMs = 0, failureRate = 0 } = {}) {
  return function mockTransport(request) {
    if (Math.random() < failureRate) throw new Error('mock provider simulated failure');
    const promptSnippet = String(request.prompt ?? '').slice(0, 80);
    return {
      output: `[mock-${request.kind}:${request.providerId}] ${promptSnippet}...`,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
    };
  };
}

export const MOCK_PROVIDERS = Object.freeze([
  Object.freeze({ providerId: 'mock-llm', kind: 'llm', priority: 100, costPerCallMinorUnits: 0 }),
  Object.freeze({ providerId: 'mock-image', kind: 'image', priority: 100, costPerCallMinorUnits: 0 }),
  Object.freeze({ providerId: 'mock-video', kind: 'video', priority: 100, costPerCallMinorUnits: 0 }),
  Object.freeze({ providerId: 'mock-voice', kind: 'voice', priority: 100, costPerCallMinorUnits: 0 })
]);

export function registerMockProviders(runtime) {
  for (const p of MOCK_PROVIDERS) {
    try { runtime.registerProvider(p); } catch (e) { if (!String(e.message).includes('duplicate_provider')) throw e; }
  }
  return MOCK_PROVIDERS;
}
