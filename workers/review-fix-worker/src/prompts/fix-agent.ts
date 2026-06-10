import type Anthropic from '@anthropic-ai/sdk';

export const FIX_AGENT_SYSTEM = `You are a code correction agent. Given a file, the diff that introduced it, and a blocking review comment, produce a corrected version of the file that resolves exactly that issue. Make minimal, targeted changes. Call apply_fix with the complete corrected file content.`;

export const APPLY_FIX_TOOL: Anthropic.Tool = {
  name: 'apply_fix',
  description: 'Submit the corrected file content',
  input_schema: {
    type: 'object',
    properties: {
      fixed_content: { type: 'string', description: 'Complete corrected file content' },
    },
    required: ['fixed_content'],
  },
};

export function buildFixAgentMessage(
  filePath: string,
  fileContent: string,
  diffSection: string,
  lineRef: string,
  feedbackMessage: string,
): string {
  return `## File: ${filePath}

### Current content
\`\`\`
${fileContent}
\`\`\`${diffSection}

### Blocking review comment${lineRef}
${feedbackMessage}`;
}
