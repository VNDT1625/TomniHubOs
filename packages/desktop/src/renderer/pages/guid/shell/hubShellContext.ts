/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useContext, useEffect } from 'react';
import type { HubAppDefinition } from '../HubHome/catalog';
import type { HubActivityControls } from '../HubHome/useHubActivity';

/** What the right rail shows; the centre page that owns a workspace publishes it. */
export type HubRailTarget = {
  workspaceName?: string;
  agentName: string;
  /** Workspace explicitly selected by the active agent tile. */
  workspace?: string;
  /** Selected native conversation id, not the activity registry id. */
    conversationId?: string;
  /** Selected live monitor item; used by the persistent Inspector. */
  activityId?: string;
  onFocusDirectory: (path: string) => void;
};

/**
 * The Hub shell (sidebar, rail, footer) stays mounted across every route; the
 * routed page in the centre reads shared live state from here instead of
 * mounting its own chrome.
 */
export type HubShellContextValue = {
  activity: HubActivityControls;
  /** Base apps whose package (if any) is installed. */
  availableApps: readonly HubAppDefinition[];
  openApp: (app: HubAppDefinition) => void;
    openTerminal: () => void;
  terminalMode: boolean;
  setTerminalMode: (enabled: boolean) => void;

  openCompanyAgent: (companyId: string, roleId: string) => void;
  setRailTarget: (target: HubRailTarget | undefined) => void;
};

export const HubShellContext = React.createContext<HubShellContextValue | null>(null);

export const useHubShell = (): HubShellContextValue | null => useContext(HubShellContext);

/** Publishes the rail target while the calling centre page is mounted. */
export const useHubRailTarget = (target: HubRailTarget | undefined): void => {
  const shell = useHubShell();
  const setRailTarget = shell?.setRailTarget;
  useEffect(() => {
    setRailTarget?.(target);
  }, [setRailTarget, target]);
  useEffect(() => () => setRailTarget?.(undefined), [setRailTarget]);
};
