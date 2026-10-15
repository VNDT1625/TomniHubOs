/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pick-lists for the assistant editor: Plugin (MCP servers, grouped by the package that contributes them) and
 * Hook (hook rules the user already has). Selecting an item only records it on the assistant; whether it runs in a
 * chat is decided when the assistant is applied, and only for items the user has already enabled or approved.
 */

import type { IMcpServer } from '@/common/config/storage';
import { ensureBackendMcpCatalog } from '@/renderer/hooks/mcp/catalog';
import { buildDefaultToolCandidates } from '@/common/types/agent/assistant/defaultToolCandidates';
import {
  ASSISTANT_DEFAULT_TOOL_LIMITS,
  isOverDefaultToolLimit,
  type DefaultToolCandidate,
} from '@/common/types/agent/assistant/assistantDefaultTools';
import { Checkbox, Tag, Typography } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** A hook row as the picker shows it. `id` is the opaque handle Main already exposes to the renderer. */
export type AssistantHookOption = {
  id: string;
  label: string;
  active: boolean;
  approved: boolean;
};

export type PluginCluster = { key: string; label: string; servers: IMcpServer[] };

/** Groups MCP servers by contributing package. Standalone servers (no package) are returned separately. */
export const groupPluginServers = (
  servers: readonly IMcpServer[]
): { clusters: PluginCluster[]; standalone: IMcpServer[] } => {
  const byPackage = new Map<string, PluginCluster>();
  const standalone: IMcpServer[] = [];
  for (const server of servers) {
    const packageName = server.extension?.name?.trim();
    if (!packageName) {
      standalone.push(server);
      continue;
    }
    const existing = byPackage.get(packageName);
    if (existing) {
      existing.servers.push(server);
    } else {
      byPackage.set(packageName, {
        key: packageName,
        label: server.extension?.displayName?.trim() || packageName,
        servers: [server],
      });
    }
  }
  const clusters = [...byPackage.values()].toSorted((a, b) => a.label.localeCompare(b.label));
  return { clusters, standalone };
};

/** Adds or removes one id, keeping the list free of duplicates. */
export const toggleId = (list: readonly string[], id: string, on: boolean): string[] => {
  if (on) return list.includes(id) ? [...list] : [...list, id];
  return list.filter((item) => item !== id);
};

const HOOK_LABEL_MAX = 120;

/** Short, single-line label for a hook row: its event, matcher and command. */
export const hookOptionLabel = (row: { event: string; matcher?: string; command: string }): string => {
  const head = row.matcher ? `${row.event} (${row.matcher})` : row.event;
  const text = `${head} · ${row.command}`.replace(/\s+/gu, ' ').trim();
  return text.length > HOOK_LABEL_MAX ? `${text.slice(0, HOOK_LABEL_MAX - 1)}…` : text;
};

/**
 * "Tool có sẵn (không cần tìm)": tools whose schema the assistant carries from the first turn. Lists every tool of every
 * MCP server, grouped by server, with a size estimate and the cap. Selecting a tool never enables its server.
 */
export const DefaultToolsSection: React.FC<{
  servers: IMcpServer[];
  selected: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}> = ({ servers, selected, onChange, disabled }) => {
  const { t } = useTranslation();
  const candidates = useMemo(() => buildDefaultToolCandidates(servers), [servers]);
  const sizeOf = new Map(candidates.map((tool) => [tool.id, tool.schemaBytes] as const));
  const chosenBytes = selected.reduce((sum, id) => sum + (sizeOf.get(id) ?? 0), 0);
  const over = isOverDefaultToolLimit(selected.length, chosenBytes);
  const groups = useMemo(() => {
    const byServer = new Map<string, { name: string; tools: DefaultToolCandidate[] }>();
    for (const tool of candidates) {
      const group = byServer.get(tool.serverId) ?? { name: tool.serverName, tools: [] };
      group.tools.push(tool);
      byServer.set(tool.serverId, group);
    }
    return [...byServer.entries()];
  }, [candidates]);
  const kb = (bytes: number) => (bytes / 1024).toFixed(1);
  return (
    <div className='flex flex-col gap-8px' data-testid='default-tools-section'>
      <div className='text-14px font-medium'>
        {t('guid.assistantDefaultToolsTitle', { defaultValue: 'Tool có sẵn (không cần tìm)' })}
      </div>
      <div className='text-12px text-t-secondary'>
        {t('guid.assistantDefaultToolsHint', {
          defaultValue:
            'Schema của các tool này được nạp ngay từ lượt đầu. Tool của plugin đang tắt hoặc chưa được duyệt sẽ không được đính kèm.',
        })}
      </div>
      <div className='text-12px text-t-secondary' data-testid='default-tools-summary'>
        {t('guid.assistantDefaultToolsSummary', {
          count: selected.length,
          max: ASSISTANT_DEFAULT_TOOL_LIMITS.maxTools,
          kb: kb(chosenBytes),
          maxKb: kb(ASSISTANT_DEFAULT_TOOL_LIMITS.maxSchemaBytes),
          defaultValue: '{{count}} / {{max}} tool · ~{{kb}} KB / {{maxKb}} KB',
        })}
      </div>
      {over ? (
        <div className='text-12px' style={{ color: 'rgb(var(--danger-6))' }} role='alert' data-testid='default-tools-over'>
          {t('guid.assistantDefaultToolsOver', {
            max: ASSISTANT_DEFAULT_TOOL_LIMITS.maxTools,
            maxKb: kb(ASSISTANT_DEFAULT_TOOL_LIMITS.maxSchemaBytes),
            defaultValue: 'Over the limit of {{max}} tools or {{maxKb}} KB. The extra tools will not be attached.',
          })}
        </div>
      ) : null}
      {groups.length === 0 ? (
        <div className='text-12px text-t-tertiary'>
          {t('guid.assistantDefaultToolsEmpty', { defaultValue: 'No plugin tools are installed yet.' })}
        </div>
      ) : null}
      {groups.map(([serverId, group]) => (
        <div key={serverId} className='flex flex-col gap-2px' data-testid={`default-tools-group-${serverId}`}>
          <div className='text-12px font-medium text-t-secondary'>{group.name}</div>
          {group.tools.map((tool) => (
            <div key={tool.id} className='flex items-center gap-8px py-4px' data-testid={`default-tool-${tool.id}`}>
              <Checkbox
                disabled={disabled}
                checked={selected.includes(tool.id)}
                onChange={(checked: boolean) => onChange(toggleId(selected, tool.id, checked))}
              >
                {tool.name}
              </Checkbox>
              <span className='text-11px text-t-tertiary'>~{kb(tool.schemaBytes)} KB</span>
              {!tool.serverEnabled || !tool.approved ? (
                <Tag size='small' color='gray'>
                  {tool.serverEnabled
                    ? t('guid.assistantDefaultToolNotApproved', { defaultValue: 'Not approved' })
                    : t('settings.assistantItemOff', { defaultValue: 'Off' })}
                </Tag>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};


export type AssistantSessionItemsSectionProps = {
  selectedPlugins: string[];
  setSelectedPlugins: (value: string[]) => void;
  selectedHooks: string[];
  setSelectedHooks: (value: string[]) => void;
  /** Default tool ids (`<serverId>::<toolName>`) attached from the first turn. */
  selectedTools?: string[];
  setSelectedTools?: (value: string[]) => void;
  disabled?: boolean;
};

const AssistantSessionItemsSection: React.FC<AssistantSessionItemsSectionProps> = ({
  selectedPlugins,
  setSelectedPlugins,
  selectedHooks,
  setSelectedHooks,
  selectedTools = [],
  setSelectedTools = () => undefined,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<IMcpServer[]>([]);
  const [hooks, setHooks] = useState<AssistantHookOption[]>([]);
  const [toolServers, setToolServers] = useState<IMcpServer[]>([]);

  useEffect(() => {
    let cancelled = false;
    void ensureBackendMcpCatalog()
      .then(({ allServers }) => {
        if (!cancelled) {
          setServers(allServers.filter((server) => server.builtin !== true));
          setToolServers(allServers);
        }
      })
      .catch(() => {
        if (!cancelled) setServers([]);
      });
    void (async () => {
      try {
        const result = await window.electronAPI?.hookSettings?.list();
        if (cancelled || !result?.ok) return;
        setHooks(
          result.data.hooks.map((row) => ({
            id: row.id,
            label: hookOptionLabel(row),
            active: row.active,
            approved: row.approved,
          }))
        );
      } catch {
        if (!cancelled) setHooks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => groupPluginServers(servers), [servers]);

  const renderPlugin = (server: IMcpServer) => (
    <div key={server.id} className='flex items-center gap-8px py-4px' data-testid={`plugin-option-${server.id}`}>
      <Checkbox
        disabled={disabled}
        checked={selectedPlugins.includes(server.id)}
        onChange={(checked: boolean) => setSelectedPlugins(toggleId(selectedPlugins, server.id, checked))}
      >
        {server.name}
      </Checkbox>
      {!server.enabled && (
        <Tag size='small' color='gray'>
          {t('settings.assistantItemOff', { defaultValue: 'Off' })}
        </Tag>
      )}
    </div>
  );

  return (
    <div className='flex flex-col gap-16px'>
      <DefaultToolsSection
        servers={toolServers}
        selected={selectedTools}
        onChange={setSelectedTools}
        disabled={disabled}
      />
      <div data-testid='assistant-plugin-section'>
        <Typography.Text bold>{t('settings.assistantPluginTitle', { defaultValue: 'Plugin' })}</Typography.Text>
        <div className='text-12px text-t-secondary mt-4px'>
          {t('settings.assistantPluginHint', {
            defaultValue: 'MCP servers and package tools this assistant uses in its chats.',
          })}
        </div>
        <div className='mt-8px flex flex-col gap-10px'>
          {grouped.clusters.map((cluster) => (
            <div key={cluster.key} className='rd-8px bg-bg-1 p-10px' data-testid={`plugin-cluster-${cluster.key}`}>
              <div className='text-13px font-medium mb-4px'>{cluster.label}</div>
              {cluster.servers.map(renderPlugin)}
            </div>
          ))}
          {grouped.standalone.length > 0 && (
            <div className='rd-8px bg-bg-1 p-10px' data-testid='plugin-cluster-other'>
              <div className='text-13px font-medium mb-4px'>
                {t('settings.assistantPluginOther', { defaultValue: 'Other' })}
              </div>
              {grouped.standalone.map(renderPlugin)}
            </div>
          )}
          {servers.length === 0 && (
            <div className='text-12px text-t-secondary'>
              {t('settings.assistantPluginEmpty', { defaultValue: 'No plugins installed.' })}
            </div>
          )}
        </div>
      </div>

      <div data-testid='assistant-hook-section'>
        <Typography.Text bold>{t('settings.assistantHookTitle', { defaultValue: 'Hook' })}</Typography.Text>
        <div className='text-12px text-t-secondary mt-4px'>
          {t('settings.assistantHookHint', {
            defaultValue:
              'Hooks run only when you have already approved and enabled them. Selecting one does not approve it.',
          })}
        </div>
        <div className='mt-8px flex flex-col gap-4px'>
          {hooks.map((hook) => (
            <div key={hook.id} className='flex items-center gap-8px py-4px' data-testid={`hook-option-${hook.id}`}>
              <Checkbox
                disabled={disabled}
                checked={selectedHooks.includes(hook.id)}
                onChange={(checked: boolean) => setSelectedHooks(toggleId(selectedHooks, hook.id, checked))}
              >
                <span className='text-13px'>{hook.label}</span>
              </Checkbox>
              {!hook.active && (
                <Tag size='small' color='gray'>
                  {hook.approved
                    ? t('settings.assistantHookInactive', { defaultValue: 'Not active' })
                    : t('settings.assistantHookNeedsApproval', { defaultValue: 'Needs approval' })}
                </Tag>
              )}
            </div>
          ))}
          {hooks.length === 0 && (
            <div className='text-12px text-t-secondary'>
              {t('settings.assistantHookEmpty', { defaultValue: 'No hooks configured.' })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssistantSessionItemsSection;
