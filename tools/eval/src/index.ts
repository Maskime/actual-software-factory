#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { evalDevAgent } from './evalDev.js';
import { evalReviewAgent } from './evalReview.js';

const { values } = parseArgs({
  options: {
    agent: { type: 'string', default: 'dev' },
    'project-id': { type: 'string', default: '3' },
    'prompts-dir': { type: 'string' },
    'output-file': { type: 'string' },
  },
});

if (values['prompts-dir']) {
  process.env.PROMPTS_DIR = values['prompts-dir'];
}

const projectId = Number.parseInt(values['project-id'] ?? '3', 10);

const { default: devCases } = await import('../fixtures/dev-cases.json', { with: { type: 'json' } });
const { default: reviewCases } = await import('../fixtures/review-cases.json', { with: { type: 'json' } });

const results =
  values.agent === 'review'
    ? await evalReviewAgent(reviewCases)
    : await evalDevAgent(devCases, projectId);

const output = JSON.stringify(
  { runAt: new Date().toISOString(), agent: values.agent, results },
  null,
  2,
);

console.log(output);

if (values['output-file']) {
  writeFileSync(values['output-file'], output, 'utf-8');
  process.stderr.write(`Results saved to ${values['output-file']}\n`);
}
