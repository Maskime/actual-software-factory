import type Anthropic from '@anthropic-ai/sdk';

export const FIX_STATIC_AGENT_SYSTEM = `You are a code correction agent. Given a TypeScript/JavaScript file and one or more SonarQube issues detected in it, produce a corrected version that resolves all listed issues. Make minimal, targeted changes. Call apply_fix with the complete corrected file content.`;

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

export function buildFixStaticAgentMessage(
  filePath: string,
  fileContent: string,
  issueList: string,
): string {
  return `## File: ${filePath}

### Current content
\`\`\`
${fileContent}
\`\`\`

### SonarQube issues to fix
${issueList}`;
}
