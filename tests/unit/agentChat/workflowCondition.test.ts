import { describe, expect, it, vi } from 'vitest';
import {
  evaluateWorkflowExpression,
  validateWorkflowExpression,
  type WorkflowExpression,
} from '@process/agentRuntime/agentMesh/workflowCondition';
import { executeToolWorkflow, type WorkflowToolResult } from '@process/agentRuntime/agentMesh/workflowEngine';

const results = new Map<string, WorkflowToolResult>([
  [
    'find',
    {
      id: 'find',
      tool: 'generic_search',
      status: 'succeeded',
      output: [{ type: 'text', text: JSON.stringify({ items: [{ path: 'src/app.ts', score: 0.98 }] }) }],
    },
  ],
  ['audit', { id: 'audit', tool: 'validate', status: 'failed', error: 'Failed validation' }],
]);

describe('Agent-authored generic workflow condition expressions', () => {
  it('evaluates arbitrary composed and/or/not/count/comparison without any tool-specific operator', () => {
    const expr: WorkflowExpression = {
      op: 'all',
      terms: [
        {
          op: 'compare',
          comparison: 'eq',
          left: { kind: 'count', of: { kind: 'step', stepId: 'find', decode: 'mcpJson', path: ['items'] } },
          right: { kind: 'literal', value: 1 },
        },
        {
          op: 'compare',
          comparison: 'gte',
          left: { kind: 'step', stepId: 'find', decode: 'mcpJson', path: ['items', '0', 'score'] },
          right: { kind: 'literal', value: 0.9 },
        },
        {
          op: 'not',
          term: { op: 'exists', value: { kind: 'step', stepId: 'find', decode: 'mcpJson', path: ['error'] } },
        },
        {
          op: 'any',
          terms: [
            {
              op: 'compare',
              comparison: 'eq',
              left: { kind: 'step', stepId: 'audit', field: 'status' },
              right: { kind: 'literal', value: 'failed' },
            },
            { op: 'isEmpty', value: { kind: 'literal', value: [] } },
          ],
        },
      ],
    };
    validateWorkflowExpression(expr, ['find', 'audit']);
    expect(evaluateWorkflowExpression(expr, results)).toBe(true);
  });

  it('rejects references to any tool not explicitly declared as a predecessor', () => {
    const expr: WorkflowExpression = {
      op: 'compare',
      comparison: 'eq',
      left: { kind: 'step', stepId: 'restricted_tool', field: 'status' },
      right: { kind: 'literal', value: 'succeeded' },
    };
    expect(() => validateWorkflowExpression(expr, ['find'])).toThrow('WORKFLOW_EXPRESSION_UNAUTHORIZED_REFERENCE');
  });

  it('guards prototype paths and enforces a finite expression depth', () => {
    const unsafe: WorkflowExpression = {
      op: 'exists',
      value: { kind: 'step', stepId: 'find', path: ['__proto__'] },
    };
    expect(() => validateWorkflowExpression(unsafe, ['find'])).toThrow('WORKFLOW_EXPRESSION_PATH_INVALID');
    let tooDeep: WorkflowExpression = { op: 'isEmpty', value: { kind: 'literal', value: null } };
    for (let i = 0; i < 20; i += 1) tooDeep = { op: 'not', term: tooDeep };
    expect(() => validateWorkflowExpression(tooDeep, [])).toThrow('WORKFLOW_EXPRESSION_LIMIT');
  });

  it('uses JSON-decoded previous tool output to decide and bind a next tool input', async () => {
    const called: string[] = [];
    const result = await executeToolWorkflow(
      [
        { id: 'find', tool: 'generic_search', input: { keyword: 'config' } },
        {
          id: 'read',
          tool: 'generic_read',
          input: {},
          dependsOn: ['find'],
          whenExpr: {
            op: 'compare',
            comparison: 'eq',
            left: { kind: 'count', of: { kind: 'step', stepId: 'find', decode: 'mcpJson', path: ['items'] } },
            right: { kind: 'literal', value: 1 },
          },
          inputFrom: { filePath: { stepId: 'find', decode: 'mcpJson', path: ['items', '0', 'path'] } },
        },
      ],
      {
        signal: new AbortController().signal,
        admit: async () => ({ release: () => undefined }),
        invoke: async ({ tool, input }) => {
          called.push(tool);
          if (tool === 'generic_search') {
            return [{ type: 'text', text: JSON.stringify({ items: [{ path: 'src/config.ts' }] }) }];
          }
          expect(input.filePath).toBe('src/config.ts');
          return [{ type: 'text', text: 'read complete' }];
        },
      }
    );
    expect(result.status).toBe('completed');
    expect(called).toEqual(['generic_search', 'generic_read']);
  });

  it('skips a followup if a generic search returns multiple matches', async () => {
    const invoke = vi.fn(async () => [
      { type: 'text', text: JSON.stringify({ items: [{ path: 'a.ts' }, { path: 'b.ts' }] }) },
    ]);
    const response = await executeToolWorkflow(
      [
        { id: 'find', tool: 'generic_search', input: {} },
        {
          id: 'read',
          tool: 'generic_read',
          input: {},
          dependsOn: ['find'],
          whenExpr: {
            op: 'compare',
            comparison: 'eq',
            left: { kind: 'count', of: { kind: 'step', stepId: 'find', decode: 'mcpJson', path: ['items'] } },
            right: { kind: 'literal', value: 1 },
          },
        },
      ],
      { signal: new AbortController().signal, admit: async () => ({ release: () => undefined }), invoke }
    );
    expect(invoke).toHaveBeenCalledOnce();
    expect(response.steps[1]?.status).toBe('skipped');
  });
});
