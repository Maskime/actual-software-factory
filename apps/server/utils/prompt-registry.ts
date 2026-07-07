import { QUALIFICATION_PROMPT } from '../prompts/qualification'

// source: DEV_AGENT_MR_DESC_SYSTEM — workers/agents/src/prompts/dev-agent.ts
const DEV_AGENT_MR_DESC =
  'You are a software engineer writing a Merge Request description. Be concise and informative.'

export type PromptSeed =
  | { agentKey: string; file: string } // lu depuis workers/prompts/<file>.md
  | { agentKey: string; content: string } // constante inline / importée

export const PROMPT_REGISTRY: PromptSeed[] = [
  { agentKey: 'dev-agent.plan', file: 'dev-generate-plan' },
  { agentKey: 'dev-agent.critique', file: 'dev-critique-plan' },
  { agentKey: 'dev-agent.implement', file: 'dev-implement-plan' },
  { agentKey: 'dev-agent.fix-errors', file: 'dev-fix-errors' },
  { agentKey: 'dev-agent.mr-description', content: DEV_AGENT_MR_DESC },
  { agentKey: 'review-agent.review', file: 'review-code' },
  { agentKey: 'review-fix-agent.fix', file: 'review-fix-code' },
  { agentKey: 'static-analysis-agent.fix', file: 'static-analysis-fix' },
  { agentKey: 'qualification.system', content: QUALIFICATION_PROMPT },
]
