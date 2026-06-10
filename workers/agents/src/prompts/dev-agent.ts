export const DEV_AGENT_PLAN_SYSTEM = `You are a senior software engineer implementing a user story. Your task is to produce a concrete, ordered implementation plan. Do NOT write any code yet.

Output a numbered list of actions. For each action specify:
- The file to create or modify (relative path)
- Exactly what to change or add
- Any prerequisite step

Be specific: mention function names, interfaces, import paths.`;

export const DEV_AGENT_CRITIQUE_SYSTEM = `You are a senior code reviewer. Analyze the implementation plan against the acceptance criteria and classify each issue.

Respond ONLY with a JSON object (no markdown fences) in this exact format:
{
  "grave": ["<issue description>"],
  "moderate": ["<issue description>"],
  "esthetic": ["<issue description>"]
}

Classification:
- grave: missing acceptance criterion, wrong architecture, security issue → must be fixed
- moderate: acceptable technical debt → create backlog item
- esthetic: naming, formatting, minor organization → can live with it`;

export const DEV_AGENT_MR_DESC_SYSTEM =
  'You are a software engineer writing a Merge Request description. Be concise and informative.';

export function buildDevAgentImplementSystem(workDir: string): string {
  return `You are a software engineer implementing a user story. You have access to the workspace filesystem via tools.
Execute the implementation plan step by step. When done, stop calling tools and end your response.
Workspace root: ${workDir}
All file paths are relative to the workspace root.`;
}

export function buildDevAgentFixErrorsSystem(workDir: string): string {
  return `You are a software engineer fixing TypeScript and lint errors. Use the filesystem tools to read and fix the files with errors.
Workspace root: ${workDir}`;
}

export function buildDevAgentPlanMessage(
  title: string,
  description: string,
  acceptanceCriteria: string[],
  dirListing: string,
): string {
  return `## User Story

**Title**: ${title}

**Description**:
${description}

**Acceptance Criteria**:
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Codebase (TypeScript files)

\`\`\`
${dirListing}
\`\`\`

Produce a detailed implementation plan.`;
}

export function buildDevAgentCritiqueMessage(
  title: string,
  acceptanceCriteria: string[],
  plan: string,
): string {
  return `## User Story

**Title**: ${title}

**Acceptance Criteria**:
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Implementation Plan

${plan}

Classify all issues with the plan.`;
}

export function buildDevAgentReviseMessage(plan: string, graveIssues: string[]): string {
  return `Revise the following implementation plan to fix the GRAVE issues listed below. Keep all other steps intact.

## Original Plan

${plan}

## GRAVE Issues to Fix

${graveIssues.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Output the revised plan only.`;
}

export function buildDevAgentImplementMessage(
  title: string,
  acceptanceCriteria: string[],
  revisedPlan: string,
): string {
  return `Implement the following plan for user story: ${title}

## Acceptance Criteria
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Implementation Plan
${revisedPlan}

Start implementing now.`;
}

export function buildDevAgentFixErrorsMessage(title: string, errors: string): string {
  return `Fix the following TypeScript/lint errors in the workspace for user story: ${title}

## Errors
\`\`\`
${errors}
\`\`\`

Read the relevant files and fix all errors.`;
}

export function buildDevAgentMrDescMessage(
  issueIid: number,
  title: string,
  acceptanceCriteria: string[],
  revisedPlan: string,
): string {
  return `Write a Merge Request description for the following user story implementation.

The description MUST start with "Closes #${issueIid}" on the first line.
Then include:
- A short summary (2-4 sentences) of what was implemented
- Key implementation choices and their justification

## User Story
**Title**: ${title}

**Acceptance Criteria**:
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Implementation Plan
${revisedPlan}

Output the MR description only, in Markdown format.`;
}
