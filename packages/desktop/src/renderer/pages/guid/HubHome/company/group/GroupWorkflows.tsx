/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RoleNode } from '@process/company/companyOrchestrator';
import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flattenRoles } from '../companyGroups';
import { runGroupWorkflow, type GroupContext } from './groupEngine';
import { chatKey, MAX_STEPS, MAX_WORKFLOWS, newId, type GroupWorkflow, type WorkflowStep } from './groupMeta';
import { useGroupMeta, useGroupSnapshot } from './useGroupChat';

type GroupWorkflowsProps = { ctx: GroupContext };

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/**
 * Group workflows: ordered steps, each handed to one agent with an instruction.
 * A run posts every step's result in the group chat and passes it to the next
 * step. A calendar event can start a workflow on a schedule.
 */
export const GroupWorkflows: React.FC<GroupWorkflowsProps> = ({ ctx }) => {
  const { t } = useTranslation();
  const groupKey = chatKey(ctx.companyId, ctx.group.id);
  const [meta, updateMeta] = useGroupMeta(groupKey);
  const { workflowRunning } = useGroupSnapshot(groupKey);
  const [editing, setEditing] = useState<GroupWorkflow | null>(null);
  const members = [ctx.group.leader, ...ctx.group.members];
  const memberIds = new Set(members.map((role) => role.id));
  const roles = [
    ...members,
    ...(flattenRoles(ctx.structure.root) as RoleNode[]).filter((role) => !memberIds.has(role.id)),
  ];

  const save = (): void => {
    if (!editing) return;
    const workflow = { ...editing, name: editing.name.trim(), steps: editing.steps.filter((step) => step.roleId) };
    updateMeta((current) => ({
      ...current,
      workflows: current.workflows.some((item) => item.id === workflow.id)
        ? current.workflows.map((item) => (item.id === workflow.id ? workflow : item))
        : [...current.workflows, workflow],
    }));
    setEditing(null);
  };

  const setStep = (index: number, change: Partial<WorkflowStep>): void =>
    setEditing((current) =>
      current
        ? { ...current, steps: current.steps.map((step, i) => (i === index ? { ...step, ...change } : step)) }
        : current
    );

  if (editing) {
    const canSave = editing.name.trim().length > 0 && editing.steps.some((step) => step.roleId);
    return (
      <div className='hub-company-pane-body' data-testid='hub-company-workflow-editor'>
        <label>
          {t('company.center.group.wf.name')}
          <input
            className='hub-company-field'
            value={editing.name}
            maxLength={120}
            data-testid='hub-company-workflow-name'
            onChange={(event) => setEditing({ ...editing, name: event.target.value })}
          />
        </label>
        {editing.steps.map((step, index) => (
          <div key={step.id} className='hub-company-block hub-company-step'>
            <div className='hub-company-step-head'>
              <strong>{t('company.center.group.wf.step', { n: index + 1 })}</strong>
              <button
                type='button'
                className='hub-company-icon-btn'
                aria-label={t('company.center.group.wf.moveUp')}
                onClick={() => setEditing({ ...editing, steps: move(editing.steps, index, index - 1) })}
              >
                <ArrowUp size={14} strokeWidth={1.75} aria-hidden='true' />
              </button>
              <button
                type='button'
                className='hub-company-icon-btn'
                aria-label={t('company.center.group.wf.moveDown')}
                onClick={() => setEditing({ ...editing, steps: move(editing.steps, index, index + 1) })}
              >
                <ArrowDown size={14} strokeWidth={1.75} aria-hidden='true' />
              </button>
              <button
                type='button'
                className='hub-company-icon-btn'
                aria-label={t('company.center.group.remove')}
                onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, i) => i !== index) })}
              >
                <Trash2 size={14} strokeWidth={1.75} aria-hidden='true' />
              </button>
            </div>
            <label>
              {t('company.center.group.wf.agent')}
              <select
                className='hub-company-field'
                value={step.roleId}
                onChange={(event) => setStep(index, { roleId: event.target.value })}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('company.center.group.wf.instruction')}
              <textarea
                className='hub-company-field'
                rows={2}
                value={step.instruction}
                maxLength={2000}
                onChange={(event) => setStep(index, { instruction: event.target.value })}
              />
            </label>
          </div>
        ))}
        <div className='hub-company-form-actions'>
          <button
            type='button'
            className='hub-q-btn'
            disabled={editing.steps.length >= MAX_STEPS}
            data-testid='hub-company-workflow-add-step'
            onClick={() =>
              setEditing({
                ...editing,
                steps: [...editing.steps, { id: newId(), roleId: roles[0]?.id ?? '', instruction: '' }],
              })
            }
          >
            <Plus size={12} strokeWidth={2} aria-hidden='true' /> {t('company.center.group.wf.addStep')}
          </button>
          <span className='hub-company-header-end' />
          <button type='button' className='hub-q-btn' onClick={() => setEditing(null)}>
            {t('company.center.cancel')}
          </button>
          <button
            type='button'
            className='hub-q-btn hub-q-btn--primary'
            disabled={!canSave}
            data-testid='hub-company-workflow-save'
            onClick={save}
          >
            {t('company.center.group.save')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='hub-company-pane-body' data-testid='hub-company-workflows'>
      <p className='hub-company-hint'>{t('company.center.group.wf.hint')}</p>
      {meta.workflows.length === 0 && <div className='hub-agents-empty'>{t('company.center.group.wf.empty')}</div>}
      <ul className='hub-company-items'>
        {meta.workflows.map((workflow) => (
          <li key={workflow.id}>
            <div>
              <strong>{workflow.name}</strong>
              <small>
                {workflow.steps.map((step) => roles.find((role) => role.id === step.roleId)?.name ?? '?').join(' → ')}
              </small>
            </div>
            <button
              type='button'
              className='hub-q-btn hub-q-btn--primary'
              disabled={workflowRunning || workflow.steps.length === 0}
              data-testid={`hub-company-workflow-run-${workflow.id}`}
              onClick={() => void runGroupWorkflow(ctx, workflow)}
            >
              <Play size={12} strokeWidth={2} aria-hidden='true' />{' '}
              {workflowRunning ? t('company.center.group.wf.running') : t('company.center.group.wf.run')}
            </button>
            <button type='button' className='hub-q-btn' onClick={() => setEditing(workflow)}>
              {t('company.center.group.wf.edit')}
            </button>
            <button
              type='button'
              className='hub-company-icon-btn'
              aria-label={t('company.center.group.remove')}
              onClick={() =>
                updateMeta((current) => ({
                  ...current,
                  workflows: current.workflows.filter((item) => item.id !== workflow.id),
                  // Events that ran this workflow fall back to a plain reminder.
                  events: current.events.map((event) =>
                    event.workflowId === workflow.id ? { ...event, workflowId: undefined } : event
                  ),
                }))
              }
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden='true' />
            </button>
          </li>
        ))}
      </ul>
      <div className='hub-company-form-actions'>
        <button
          type='button'
          className='hub-q-btn hub-q-btn--primary'
          disabled={meta.workflows.length >= MAX_WORKFLOWS}
          data-testid='hub-company-workflow-new'
          onClick={() =>
            setEditing({
              id: newId(),
              name: '',
              steps: [{ id: newId(), roleId: ctx.group.leader.id, instruction: '' }],
            })
          }
        >
          <Plus size={12} strokeWidth={2} aria-hidden='true' /> {t('company.center.group.wf.add')}
        </button>
      </div>
    </div>
  );
};
