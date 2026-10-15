/**
 * Deterministic Agent-authored condition DSL. No eval, VM, process access, or
 * side effects. Independent of specific tools: only completed step snapshots
 * and explicit scalar/list transforms are visible.
 */
import type { WorkflowToolResult } from './workflowEngine';

export type WorkflowOperand =
  | { kind: 'literal'; value: unknown }
  | {
      kind: 'step';
      stepId: string;
      field?: 'output' | 'status' | 'error' | 'fileMatchCount';
      path?: string[];
      decode?: 'mcpText' | 'mcpJson';
    }
  | { kind: 'count'; of: WorkflowOperand };

export type WorkflowExpression =
  | { op: 'all' | 'any'; terms: WorkflowExpression[] }
  | { op: 'not'; term: WorkflowExpression }
  | {
      op: 'compare';
      comparison: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
      left: WorkflowOperand;
      right: WorkflowOperand;
    }
  | { op: 'exists' | 'isEmpty'; value: WorkflowOperand };

const NAME = /^[A-Za-z][A-Za-z0-9_:-]*$/u;
const forbiddenPart = (part: string): boolean =>
  !part || part.length > 128 || part === '__proto__' || part === 'constructor' || part === 'prototype';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const MAX_DEPTH = 10;
const MAX_NODES = 96;
const MAX_COLLECTION = 100_000;

export const validateWorkflowExpression = (expression: WorkflowExpression, dependencies: readonly string[]): void => {
  const budget = { remaining: MAX_NODES };
  const validateOperand = (value: WorkflowOperand, depth: number): void => {
    if (--budget.remaining < 0 || depth > MAX_DEPTH || !isRecord(value)) throw new Error('WORKFLOW_EXPRESSION_LIMIT');
    if (value.kind === 'literal') {
      if (!Object.prototype.hasOwnProperty.call(value, 'value')) throw new Error('WORKFLOW_EXPRESSION_LITERAL');
      return;
    }
    if (value.kind === 'count') {
      validateOperand(value.of, depth + 1);
      return;
    }
    if (value.kind !== 'step' || !NAME.test(value.stepId) || !dependencies.includes(value.stepId)) {
      throw new Error('WORKFLOW_EXPRESSION_UNAUTHORIZED_REFERENCE');
    }
    if (value.path?.length && (value.path.length > 16 || value.path.some(forbiddenPart))) {
      throw new Error('WORKFLOW_EXPRESSION_PATH_INVALID');
    }
    if (value.field && !['output', 'status', 'error', 'fileMatchCount'].includes(value.field)) {
      throw new Error('WORKFLOW_EXPRESSION_FIELD_INVALID');
    }
    if (value.decode && !['mcpText', 'mcpJson'].includes(value.decode)) {
      throw new Error('WORKFLOW_EXPRESSION_DECODER_INVALID');
    }
  };
  const visit = (node: WorkflowExpression, depth: number): void => {
    if (--budget.remaining < 0 || depth > MAX_DEPTH || !isRecord(node)) throw new Error('WORKFLOW_EXPRESSION_LIMIT');
    if (node.op === 'all' || node.op === 'any') {
      if (!Array.isArray(node.terms) || !node.terms.length || node.terms.length > 24) {
        throw new Error('WORKFLOW_EXPRESSION_TERMS_INVALID');
      }
      node.terms.forEach((child) => visit(child, depth + 1));
    } else if (node.op === 'not') {
      visit(node.term, depth + 1);
    } else if (node.op === 'exists' || node.op === 'isEmpty') {
      validateOperand(node.value, depth + 1);
    } else if (node.op === 'compare') {
      if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(node.comparison)) {
        throw new Error('WORKFLOW_EXPRESSION_COMPARATOR_INVALID');
      }
      validateOperand(node.left, depth + 1);
      validateOperand(node.right, depth + 1);
    } else throw new Error('WORKFLOW_EXPRESSION_OP_INVALID');
  };
  visit(expression, 0);
};

const property = (value: unknown, part: string): unknown => {
  if (forbiddenPart(part) || !value || typeof value !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(value, part)) return undefined;
  return (value as Record<string, unknown>)[part];
};

export const evaluateWorkflowExpression = (
  expression: WorkflowExpression,
  results: ReadonlyMap<string, WorkflowToolResult>
): boolean => {
  const resolve = (operand: WorkflowOperand): unknown => {
    if (operand.kind === 'literal') return operand.value;
    if (operand.kind === 'count') {
      const value = resolve(operand.of);
      if (Array.isArray(value) && value.length <= MAX_COLLECTION) return value.length;
      if (typeof value === 'string' && value.length <= MAX_COLLECTION) return value.length;
      if (isRecord(value) && Object.keys(value).length <= MAX_COLLECTION) return Object.keys(value).length;
      return undefined;
    }
    const result = results.get(operand.stepId);
    if (!result) return undefined;
    let value: unknown = result[operand.field ?? 'output'];
    if (operand.decode) {
      if (!Array.isArray(value) || value.length !== 1) return undefined;
      const first = value[0];
      if (!isRecord(first) || first.type !== 'text' || typeof first.text !== 'string') return undefined;
      value = first.text;
      if (operand.decode === 'mcpJson') {
        try {
          value = JSON.parse(value as string);
        } catch {
          return undefined;
        }
      }
    }
    for (const part of operand.path ?? []) value = property(value, part);
    return value;
  };

  const evaluate = (node: WorkflowExpression): boolean => {
    if ('terms' in node) return node.op === 'all' ? node.terms.every(evaluate) : node.terms.some(evaluate);
    if ('term' in node) return !evaluate(node.term);
    if ('value' in node) {
      const value = resolve(node.value);
      if (node.op === 'exists') return value !== undefined;
      if (value === undefined || value === null) return true;
      if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
      if (isRecord(value)) return Object.keys(value).length === 0;
      return false;
    }
    const left = resolve(node.left);
    const right = resolve(node.right);
    if (node.comparison === 'eq') return left !== undefined && left === right;
    if (node.comparison === 'ne') return left !== undefined && right !== undefined && left !== right;
    if (node.comparison === 'contains') {
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      if (Array.isArray(left)) return left.length <= MAX_COLLECTION && left.some((element) => element === right);
      return false;
    }
    if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) return false;
    if (typeof left === 'number' && (!Number.isFinite(left) || !Number.isFinite(right))) return false;
    const a = left as number | string;
    const b = right as number | string;
    if (node.comparison === 'gt') return a > b;
    if (node.comparison === 'gte') return a >= b;
    if (node.comparison === 'lt') return a < b;
    return a <= b;
  };
  return evaluate(expression);
};
