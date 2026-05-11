import { execFile } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to workspace root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the workspace. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to workspace root' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string in a file. Fails if old_string is not found.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to workspace root' },
        old_string: { type: 'string', description: 'Exact string to replace' },
        new_string: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'execute_bash',
    description: 'Execute a shell command in the workspace root. Use for build, test, and install commands only.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories at a path in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path relative to workspace root (use "." for root)',
        },
      },
      required: ['path'],
    },
  },
];

function safePath(workDir: string, relativePath: string): string {
  const abs = resolve(join(workDir, relativePath));
  if (!abs.startsWith(resolve(workDir))) {
    throw new Error(`Path escape attempt: ${relativePath}`);
  }
  return abs;
}

async function toolReadFile(input: Record<string, unknown>, workDir: string): Promise<string> {
  const path = safePath(workDir, input['path'] as string);
  const content = await readFile(path, 'utf-8');
  return content;
}

async function toolWriteFile(input: Record<string, unknown>, workDir: string): Promise<string> {
  const path = safePath(workDir, input['path'] as string);
  const content = input['content'] as string;
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf-8');
  return `Written: ${input['path'] as string}`;
}

async function toolEditFile(input: Record<string, unknown>, workDir: string): Promise<string> {
  const path = safePath(workDir, input['path'] as string);
  const oldString = input['old_string'] as string;
  const newString = input['new_string'] as string;
  const content = await readFile(path, 'utf-8');
  if (!content.includes(oldString)) {
    throw new Error(`old_string not found in ${input['path'] as string}`);
  }
  await writeFile(path, content.replace(oldString, newString), 'utf-8');
  return `Edited: ${input['path'] as string}`;
}

async function toolExecuteBash(input: Record<string, unknown>, workDir: string): Promise<string> {
  const command = input['command'] as string;
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
      cwd: workDir,
      timeout: 60_000,
      maxBuffer: 1024 * 1024 * 4,
    });
    return [stdout, stderr].filter(Boolean).join('\n');
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    return `[exit error]\n${out}`;
  }
}

async function toolListDir(input: Record<string, unknown>, workDir: string): Promise<string> {
  const path = safePath(workDir, input['path'] as string);
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .join('\n');
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  workDir: string
): Promise<string> {
  switch (name) {
    case 'read_file':    return toolReadFile(input, workDir);
    case 'write_file':   return toolWriteFile(input, workDir);
    case 'edit_file':    return toolEditFile(input, workDir);
    case 'execute_bash': return toolExecuteBash(input, workDir);
    case 'list_dir':     return toolListDir(input, workDir);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
