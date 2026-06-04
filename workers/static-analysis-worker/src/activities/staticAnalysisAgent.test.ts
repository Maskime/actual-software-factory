import { describe, it, expect } from 'vitest';
import { runStaticAnalysisAgent } from './staticAnalysisAgent.js';
import type { PipelineInput } from './staticAnalysisAgent.js';

const input: PipelineInput = { issueIid: 1, projectId: 3 };

describe('runStaticAnalysisAgent stub', () => {
  it('resolves to undefined (stub — implementation pending EPIC-09)', async () => {
    await expect(runStaticAnalysisAgent(input)).resolves.toBeUndefined();
  });
});
