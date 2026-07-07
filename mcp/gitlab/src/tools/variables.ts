import { z } from "zod";
import { type GitLabClient, type ToolResult } from "../gitlab-client.js";
import { projectPath, errorResponse } from "./utils.js";

interface GitLabVariable {
  key: string;
  value: string;
  variable_type: string;
  protected: boolean;
  masked: boolean;
  raw: boolean;
  environment_scope: string;
  description: string | null;
}

/**
 * Projection des métadonnées d'une variable CI/CD.
 * SÉCURITÉ : la propriété `value` n'est JAMAIS renvoyée. Les valeurs de
 * variables masquées sont sensibles (secrets, tokens) et ne doivent jamais
 * transiter dans une réponse d'outil ni être loggées. Seules les métadonnées
 * (clé, type, protected, masked, raw, scope, description) sont exposées.
 */
function variableMetadata(v: GitLabVariable): Omit<GitLabVariable, "value"> {
  return {
    key: v.key,
    variable_type: v.variable_type,
    protected: v.protected,
    masked: v.masked,
    raw: v.raw,
    environment_scope: v.environment_scope,
    description: v.description,
  };
}

/**
 * Construit le chemin d'une variable. La clé est toujours URL-encodée.
 * Quand `environmentScope` est fourni, le filtre de ciblage
 * `filter[environment_scope]` est encodé DANS le chemin — nécessaire pour
 * put()/delete() qui n'acceptent pas de query params.
 */
function variablePath(
  projectId: string,
  key: string,
  environmentScope?: string
): string {
  const base = `${projectPath(projectId)}/variables/${encodeURIComponent(key)}`;
  if (environmentScope === undefined) return base;
  const qs = new URLSearchParams({
    "filter[environment_scope]": environmentScope,
  }).toString();
  return `${base}?${qs}`; // -> ...?filter%5Benvironment_scope%5D=...
}

/** Query params de ciblage par scope, pour get() qui accepte un 2ᵉ argument. */
function scopeParams(scope?: string): Record<string, unknown> | undefined {
  return scope === undefined
    ? undefined
    : { "filter[environment_scope]": scope };
}

/**
 * Construit le corps d'une requête create/update en n'incluant que les champs
 * de variable effectivement fournis. N'inclut JAMAIS `filter_environment_scope`
 * (paramètre de ciblage, pas un champ de variable). Pour un update, `key` est
 * omise (la clé n'est pas modifiable).
 */
function variableBody(params: {
  key?: string;
  value?: string;
  variable_type?: string;
  protected?: boolean;
  masked?: boolean;
  raw?: boolean;
  environment_scope?: string;
  description?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.key !== undefined) body.key = params.key;
  if (params.value !== undefined) body.value = params.value;
  if (params.variable_type !== undefined)
    body.variable_type = params.variable_type;
  if (params.protected !== undefined) body.protected = params.protected;
  if (params.masked !== undefined) body.masked = params.masked;
  if (params.raw !== undefined) body.raw = params.raw;
  if (params.environment_scope !== undefined)
    body.environment_scope = params.environment_scope;
  if (params.description !== undefined) body.description = params.description;
  return body;
}

export const listVariablesSchema = z.object({
  project_id: z
    .string()
    .describe("Project ID or URL-encoded namespace/project"),
});

export const getVariableSchema = z.object({
  project_id: z
    .string()
    .describe("Project ID or URL-encoded namespace/project"),
  key: z.string().min(1).describe("Variable key (name)"),
  environment_scope: z
    .string()
    .optional()
    .describe(
      "Target the variable defined for this environment scope (e.g. 'production', '*'). Required when the same key exists for multiple scopes."
    ),
});

export const createVariableSchema = z.object({
  project_id: z
    .string()
    .describe("Project ID or URL-encoded namespace/project"),
  key: z
    .string()
    .min(1)
    .describe("Variable key (name). Only letters, digits and underscores."),
  value: z.string().describe("Variable value (secret if masked)"),
  variable_type: z
    .enum(["env_var", "file"])
    .optional()
    .describe("Variable type: 'env_var' (default) or 'file'"),
  protected: z
    .boolean()
    .optional()
    .describe("Whether the variable is only exposed to protected branches/tags"),
  masked: z
    .boolean()
    .optional()
    .describe("Whether the variable value is masked in job logs"),
  raw: z
    .boolean()
    .optional()
    .describe("Whether the variable is expanded (false) or used raw (true)"),
  environment_scope: z
    .string()
    .optional()
    .describe("Environment scope the variable applies to (e.g. 'production', '*')"),
  description: z.string().optional().describe("Optional variable description"),
});

export const updateVariableSchema = z.object({
  project_id: z
    .string()
    .describe("Project ID or URL-encoded namespace/project"),
  key: z.string().min(1).describe("Variable key (name) to update"),
  value: z.string().describe("New variable value"),
  variable_type: z
    .enum(["env_var", "file"])
    .optional()
    .describe("Variable type: 'env_var' or 'file'"),
  protected: z
    .boolean()
    .optional()
    .describe("Whether the variable is only exposed to protected branches/tags"),
  masked: z
    .boolean()
    .optional()
    .describe("Whether the variable value is masked in job logs"),
  raw: z
    .boolean()
    .optional()
    .describe("Whether the variable is expanded (false) or used raw (true)"),
  environment_scope: z
    .string()
    .optional()
    .describe(
      "The NEW environment scope for the variable (sent in the request body). Setting this to a different scope moves the variable (e.g. from 'staging' to 'production')."
    ),
  filter_environment_scope: z
    .string()
    .optional()
    .describe(
      "Targets the EXISTING variable to update via filter[environment_scope]. Use when the same key exists for multiple scopes so GitLab knows which one to update. Unlike environment_scope, it does not change the variable's scope."
    ),
  description: z.string().optional().describe("Optional variable description"),
});

export const deleteVariableSchema = z.object({
  project_id: z
    .string()
    .describe("Project ID or URL-encoded namespace/project"),
  key: z.string().min(1).describe("Variable key (name) to delete"),
  environment_scope: z
    .string()
    .optional()
    .describe(
      "Target the variable defined for this environment scope. Required when the same key exists for multiple scopes."
    ),
});

export async function handleListVariables(
  client: GitLabClient,
  params: z.infer<typeof listVariablesSchema>
): Promise<ToolResult> {
  try {
    const variables = await client.get<GitLabVariable[]>(
      `${projectPath(params.project_id)}/variables`,
      { per_page: 100 }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(variables.map(variableMetadata)),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleGetVariable(
  client: GitLabClient,
  params: z.infer<typeof getVariableSchema>
): Promise<ToolResult> {
  try {
    const variable = await client.get<GitLabVariable>(
      variablePath(params.project_id, params.key),
      scopeParams(params.environment_scope)
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(variableMetadata(variable)),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleCreateVariable(
  client: GitLabClient,
  params: z.infer<typeof createVariableSchema>
): Promise<ToolResult> {
  try {
    const variable = await client.post<GitLabVariable>(
      `${projectPath(params.project_id)}/variables`,
      variableBody(params)
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(variableMetadata(variable)),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleUpdateVariable(
  client: GitLabClient,
  params: z.infer<typeof updateVariableSchema>
): Promise<ToolResult> {
  try {
    // Le ciblage se fait dans le chemin (put() n'accepte pas de query params).
    // Le body ne contient ni `key` (non modifiable) ni `filter_environment_scope`
    // (paramètre de ciblage), mais garde `environment_scope` = nouveau scope.
    const { key, filter_environment_scope, ...bodyParams } = params;
    const variable = await client.put<GitLabVariable>(
      variablePath(params.project_id, key, filter_environment_scope),
      variableBody(bodyParams)
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(variableMetadata(variable)),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleDeleteVariable(
  client: GitLabClient,
  params: z.infer<typeof deleteVariableSchema>
): Promise<ToolResult> {
  try {
    await client.delete(
      variablePath(params.project_id, params.key, params.environment_scope)
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            deleted: true,
            key: params.key,
            environment_scope: params.environment_scope,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
