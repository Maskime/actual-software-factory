import type Anthropic from '@anthropic-ai/sdk';

export const REVIEW_AGENT_SYSTEM = `You are a senior code reviewer. Analyze the MR diff and produce a structured review.

Classify each finding as:
- bloquant: mandatory fix before merge — correctness bugs, security vulnerabilities (OWASP Top 10), breaking changes, data loss risks
- modéré: important improvement, deferrable — code quality debt, missing error handling, minor security concerns
- esthétique: style/convention only — naming, formatting, non-functional organization. No automatic action will be taken.

Review criteria:
1. Code quality: correctness, error handling, edge cases, performance
2. Readability: naming clarity, function size, cognitive complexity
3. Security (OWASP): injection, broken auth, sensitive data exposure, XSS, CSRF, insecure deserialization, vulnerable components
4. Codebase consistency: existing patterns, naming conventions, architectural style

Only report genuine issues. Call submit_review with all findings (empty array if none).`;

export const SUBMIT_REVIEW_TOOL: Anthropic.Tool = {
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
            file:           { type: 'string', description: 'File path relative to repository root' },
            line:           { type: ['integer', 'null'], description: 'Line number in the new version, or null for file-level comments' },
            description:    { type: 'string', description: 'Description of the issue found' },
            classification: {
              type: 'string',
              enum: ['bloquant', 'modéré', 'esthétique'],
              description: 'Severity classification',
            },
          },
          required: ['file', 'line', 'description', 'classification'],
        },
      },
    },
    required: ['comments'],
  },
};

export function buildReviewAgentMessage(
  title: string,
  description: string,
  formattedDiff: string,
): string {
  const descriptionSection = description ? `\n\nDescription: ${description}` : '';
  return `## MR: ${title}${descriptionSection}

## Diff

${formattedDiff}`;
}
