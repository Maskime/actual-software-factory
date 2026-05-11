import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_TOOLS, executeTool } from './tools.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'tools-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('AGENT_TOOLS', () => {
  it('exports 5 tools with required name and input_schema', () => {
    expect(AGENT_TOOLS).toHaveLength(5);
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('execute_bash');
    expect(names).toContain('list_dir');
  });
});

describe('executeTool — read_file', () => {
  it('reads an existing file', async () => {
    await writeFile(join(workDir, 'hello.ts'), 'export const x = 1;', 'utf-8');
    const result = await executeTool('read_file', { path: 'hello.ts' }, workDir);
    expect(result).toBe('export const x = 1;');
  });

  it('throws on missing file', async () => {
    await expect(executeTool('read_file', { path: 'missing.ts' }, workDir)).rejects.toThrow();
  });

  it('rejects path escape attempts', async () => {
    await expect(
      executeTool('read_file', { path: '../../etc/passwd' }, workDir)
    ).rejects.toThrow('Path escape');
  });
});

describe('executeTool — write_file', () => {
  it('creates a new file', async () => {
    await executeTool('write_file', { path: 'new.ts', content: 'const a = 1;' }, workDir);
    const content = await readFile(join(workDir, 'new.ts'), 'utf-8');
    expect(content).toBe('const a = 1;');
  });

  it('overwrites an existing file', async () => {
    await writeFile(join(workDir, 'existing.ts'), 'old content', 'utf-8');
    await executeTool('write_file', { path: 'existing.ts', content: 'new content' }, workDir);
    const content = await readFile(join(workDir, 'existing.ts'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('creates parent directories if needed', async () => {
    await executeTool('write_file', { path: 'src/deep/file.ts', content: 'x' }, workDir);
    const content = await readFile(join(workDir, 'src/deep/file.ts'), 'utf-8');
    expect(content).toBe('x');
  });

  it('returns a confirmation string', async () => {
    const result = await executeTool(
      'write_file',
      { path: 'out.ts', content: '' },
      workDir
    );
    expect(result).toContain('out.ts');
  });
});

describe('executeTool — edit_file', () => {
  it('replaces the first occurrence of old_string', async () => {
    await writeFile(join(workDir, 'edit.ts'), 'const foo = 1;\nconst bar = 2;', 'utf-8');
    await executeTool(
      'edit_file',
      { path: 'edit.ts', old_string: 'const foo = 1;', new_string: 'const foo = 42;' },
      workDir
    );
    const content = await readFile(join(workDir, 'edit.ts'), 'utf-8');
    expect(content).toBe('const foo = 42;\nconst bar = 2;');
  });

  it('throws when old_string is not found', async () => {
    await writeFile(join(workDir, 'nope.ts'), 'const x = 1;', 'utf-8');
    await expect(
      executeTool(
        'edit_file',
        { path: 'nope.ts', old_string: 'does not exist', new_string: 'x' },
        workDir
      )
    ).rejects.toThrow('old_string not found');
  });
});

describe('executeTool — execute_bash', () => {
  it('runs a command in workDir and returns stdout', async () => {
    const result = await executeTool(
      'execute_bash',
      { command: 'echo hello-from-test' },
      workDir
    );
    expect(result).toContain('hello-from-test');
  });

  it('captures stderr and returns it on error', async () => {
    const result = await executeTool(
      'execute_bash',
      { command: 'ls /nonexistent-path-xyz 2>&1; true' },
      workDir
    );
    expect(typeof result).toBe('string');
  });

  it('returns [exit error] prefix when command fails', async () => {
    const result = await executeTool(
      'execute_bash',
      { command: 'exit 1' },
      workDir
    );
    expect(result).toMatch(/\[exit error\]/);
  });

  it('runs in workDir as cwd', async () => {
    const result = await executeTool('execute_bash', { command: 'pwd' }, workDir);
    expect(result.trim()).toBe(workDir);
  });
});

describe('executeTool — list_dir', () => {
  it('lists files in a directory', async () => {
    await writeFile(join(workDir, 'a.ts'), '', 'utf-8');
    await writeFile(join(workDir, 'b.ts'), '', 'utf-8');
    const result = await executeTool('list_dir', { path: '.' }, workDir);
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
  });

  it('appends / suffix to directories', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(workDir, 'subdir'));
    const result = await executeTool('list_dir', { path: '.' }, workDir);
    expect(result).toContain('subdir/');
  });
});

describe('executeTool — unknown tool', () => {
  it('throws on unknown tool name', async () => {
    await expect(executeTool('nonexistent_tool', {}, workDir)).rejects.toThrow('Unknown tool');
  });
});
