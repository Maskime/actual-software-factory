import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt } from '@factory/worker-shared';
import { fetchMrDiffs } from './gitlab.js';
import { type EvalResult, promptHash, scoreCriteriaHit, scoreMentionsFiles } from './metrics.js';

const SUBMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: 'submit_review',
  description: 'Submit the complete structured code review result',
  input_schema: {
    type: 'object',
    properties: {
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
            description: { type: 'string' },
            classification: { type: 'string', enum: ['bloquant', 'modéré', 'esthétique'] },
          },
          required: ['file', 'description', 'classification'],
        },
      },
    },
    required: ['comments'],
  },
};

function formatDiff(diffs: Array<{ new_path: string; diff: string }>): string {
  return diffs
    .slice(0, 5)
    .map((f) => `### ${f.new_path}\n\`\`\`diff\n${f.diff.slice(0, 2000)}\n\`\`\``)
    .join('\n\n');
}

interface ReviewComment {
  file: string;
  line?: number;
  description: string;
  classification: string;
}

export async function evalReviewAgent(
  cases: Array<{ mrIid: number; projectId: number; description: string }>,
): Promise<EvalResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const results: EvalResult[] = [];

  for (const fixture of cases) {
    const diffs = await fetchMrDiffs(fixture.projectId, fixture.mrIid);
    const systemText = loadPrompt('review-code');
    const diffText = formatDiff(diffs);

    const t0 = Date.now();
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: systemText }],
      tools: [SUBMIT_REVIEW_TOOL],
      tool_choice: { type: 'tool', name: 'submit_review' },
      messages: [{ role: 'user', content: `Review this MR diff:\n\n${diffText}` }],
    });
    const durationMs = Date.now() - t0;

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const comments: ReviewComment[] = toolUse
      ? ((toolUse.input as { comments: ReviewComment[] }).comments ?? [])
      : [];

    const outputText = JSON.stringify(comments);
    const classifications = ['bloquant', 'modéré', 'esthétique'];

    results.push({
      iid: fixture.mrIid,
      durationMs,
      outputLength: outputText.length,
      structureValid: Array.isArray(comments),
      mentionsFiles: scoreMentionsFiles(outputText),
      criteriaHit: scoreCriteriaHit(outputText, classifications),
      criteriaTotal: classifications.length,
      promptVersion: promptHash(systemText),
    });
  }

  return results;
}
