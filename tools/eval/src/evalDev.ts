import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt } from '@factory/worker-shared';
import { fetchIssue } from './gitlab.js';
import { type EvalResult, promptHash, scoreCriteriaHit, scoreMentionsFiles, scoreStructure } from './metrics.js';

function extractCriteria(description: string): string[] {
  return description
    .split('\n')
    .filter((l) => /^\s*[-*]\s+\[[ x]\]/.test(l) || /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+\[[ x]\]\s*/, '').trim())
    .filter(Boolean);
}

function buildUserMessage(issue: { title: string; description: string }, dirListing: string): string {
  const criteria = extractCriteria(issue.description);
  const criteriaLines = criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const criteriaSection = criteria.length > 0 ? `**Acceptance Criteria**:\n${criteriaLines}\n` : '';
  return `## User Story

**Title**: ${issue.title}

**Description**:
${issue.description}

${criteriaSection}## Codebase (TypeScript files)

\`\`\`
${dirListing}
\`\`\`

Produce a detailed implementation plan.`;
}

export async function evalDevAgent(
  cases: Array<{ iid: number; description: string }>,
  projectId: number,
): Promise<EvalResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const results: EvalResult[] = [];

  for (const fixture of cases) {
    const issue = await fetchIssue(projectId, fixture.iid);
    const criteria = extractCriteria(issue.description);
    const systemText = loadPrompt('dev-generate-plan');

    const t0 = Date.now();
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: systemText }],
      messages: [{ role: 'user', content: buildUserMessage(issue, '(no listing in eval mode)') }],
    });
    const durationMs = Date.now() - t0;

    const output = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    results.push({
      iid: fixture.iid,
      durationMs,
      outputLength: output.length,
      structureValid: scoreStructure(output),
      mentionsFiles: scoreMentionsFiles(output),
      criteriaHit: scoreCriteriaHit(output, criteria),
      criteriaTotal: criteria.length,
      promptVersion: promptHash(systemText),
    });
  }

  return results;
}
