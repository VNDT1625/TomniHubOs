import { describe, expect, it } from 'vitest';
import {
  resolveTaskDependencies,
  type ChecklistItem,
} from '../../../packages/desktop/src/renderer/pages/conversation/Messages/components/InteractiveChecklist';

describe('InteractiveChecklist', () => {
  it('resolves DAG dependencies correctly: blocks dependent tasks until prerequisite is done', () => {
    const items: ChecklistItem[] = [
      { id: '1', label: 'Viết mã nguồn', status: 'in_progress', assignee: 'agent' },
      { id: '2', label: 'Chạy kiểm thử', status: 'todo', dependsOn: ['1'], assignee: 'agent' },
      { id: '3', label: 'Tài liệu hướng dẫn', status: 'todo', assignee: 'user' },
    ];

    const resolved = resolveTaskDependencies(items);

    expect(resolved[0].effectiveStatus).toBe('in_progress');
    // Task 2 depends on 1 which is not done -> blocked!
    expect(resolved[1].effectiveStatus).toBe('blocked');
    expect(resolved[1].blockingDependency).toBe('1');
    // Task 3 is independent -> remains todo!
    expect(resolved[2].effectiveStatus).toBe('todo');
  });

  it('unblocks dependent task when prerequisite completes', () => {
    const items: ChecklistItem[] = [
      { id: '1', label: 'Viết mã nguồn', status: 'done', assignee: 'agent' },
      { id: '2', label: 'Chạy kiểm thử', status: 'todo', dependsOn: ['1'], assignee: 'agent' },
    ];

    const resolved = resolveTaskDependencies(items);

    expect(resolved[0].effectiveStatus).toBe('done');
    expect(resolved[1].effectiveStatus).toBe('todo');
  });
});
