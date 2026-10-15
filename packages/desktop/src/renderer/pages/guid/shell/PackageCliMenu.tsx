/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { Up } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { terminalCliEntriesOf, type TerminalCliEntry } from '@/common/integrations/cli/packageCli';
import { packageCliClient } from '@/common/integrations/cli/packageCliClient';
import type { PackageListing } from '@/common/packages';

type PackageCliMenuProps = {
  /** The installed packages whose connections are read for CLIs that are turned on. */
  installedPackages: readonly PackageListing[];
  /** Workspace the new terminal starts in, when one is known. */
  workspace?: string;
  /** Shows the terminal after a line was typed into a new session. */
  onOpened: () => void;
};

/** The CLIs of the installed packages that are on and healthy. Ids and titles only. */
const useTerminalClis = (installedPackages: readonly PackageListing[]) => {
  const [entries, setEntries] = useState<readonly TerminalCliEntry[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    const connections = window.electronAPI?.packageConnections;
    if (!connections) {
      setEntries([]);
      return;
    }
    const packageIds = installedPackages.flatMap((item) => (item.installedManifest ? [item.installedManifest.id] : []));
    void Promise.all(
      packageIds.map((packageId) =>
        connections.list({ packageId }).then(
          (result): TerminalCliEntry[] => (result.ok ? terminalCliEntriesOf(packageId, result.data) : []),
          (): TerminalCliEntry[] => []
        )
      )
    ).then((lists) => {
      if (alive.current) setEntries(lists.flat());
    });
  }, [installedPackages]);

  useEffect(reload, [reload]);
  return { entries, reload };
};

/**
 * "Open terminal with <CLI>" (design S14): a caret beside the Terminal button listing the package CLIs that are turned
 * on. Choosing one opens a new terminal session with the command typed in and not run. The renderer sends the two ids
 * and nothing else; Main chooses the command.
 */
const PackageCliMenu: React.FC<PackageCliMenuProps> = ({ installedPackages, workspace, onOpened }) => {
  const { t } = useTranslation();
  const { entries, reload } = useTerminalClis(installedPackages);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = useCallback(
    (entry: TerminalCliEntry) => {
      setOpen(false);
      void packageCliClient
        .openInTerminal(
          { packageId: entry.packageId, connectionId: entry.connectionId },
          workspace === undefined ? {} : { cwd: workspace }
        )
        .then((result) => {
          if (result.ok === false) {
            Message.error(t('guid.hubHome.layout.terminalOpenFailed'));
            return;
          }
          Message.info(t('guid.hubHome.layout.terminalTyped'));
          onOpened();
        });
    },
    [onOpened, t, workspace]
  );

  if (entries.length === 0) return null;
  return (
    <span className='hub-sb-menu-wrap' ref={wrapRef}>
      <button
        type='button'
        className='hub-sb-btn hub-sb-terminal-menu'
        title={t('guid.hubHome.layout.terminalMenu')}
        aria-label={t('guid.hubHome.layout.terminalMenu')}
        aria-haspopup='menu'
        aria-expanded={open}
        data-testid='hub-footer-terminal-menu'
        onClick={() => {
          if (!open) reload();
          setOpen((current) => !current);
        }}
      >
        <Up theme='outline' size={10} fill='currentColor' />
      </button>
      {open && (
        <div className='hub-sb-menu' role='menu' data-testid='hub-footer-terminal-menu-list'>
          {entries.map((entry) => (
            <button
              key={entry.id}
              type='button'
              role='menuitem'
              className='hub-sb-menu-item'
              data-testid='hub-footer-terminal-menu-item'
              onClick={() => choose(entry)}
            >
              {t('guid.hubHome.layout.terminalWith', { name: entry.title })}
            </button>
          ))}
        </div>
      )}
    </span>
  );
};

export default PackageCliMenu;
