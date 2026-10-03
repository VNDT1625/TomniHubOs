/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@arco-design/web-react';
import {
  AllApplication,
  CloseSmall,
  Gift,
  MessageOne,
  Pic,
  Refresh,
  Robot,
  Search,
  Shield,
  User,
} from '@icon-park/react';
import { ipcBridge } from '@/common';
import { FIRST_PARTY_PACKAGE_CATALOG } from '@/common/packages/catalog';
import type { TChatConversation } from '@/common/config/storage';
import '@/renderer/styles/glassmorphism.css';

interface GlobalSearchModalProps {
  visible: boolean;
  onClose: () => void;
}

type SearchCategory = 'conversation' | 'app' | 'action';

interface SearchItem {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ visible, onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<TChatConversation[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load conversations when modal opens
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }

    let cancelled = false;
    void ipcBridge.database.getUserConversations
      .invoke({ limit: 100 })
      .then((res: { items?: TChatConversation[] }) => {
        if (!cancelled && res?.items) {
          setConversations(res.items);
        }
      })
      .catch(() => {
        // ignore load errors
      });

    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Static Quick Actions
  const quickActions = useMemo<SearchItem[]>(
    () => [
      {
        id: 'action-display',
        category: 'action',
        title: 'Cài đặt Giao diện & Chủ đề (Themes)',
        subtitle: 'Tùy chỉnh màu sắc, chủ đề CSS và Package UI',
        icon: <Pic theme='outline' size={16} fill='currentColor' />,
        action: () => {
          void navigate('/settings/display');
          onClose();
        },
      },
      {
        id: 'action-personal',
        category: 'action',
        title: 'Hồ sơ Cá nhân & Tài khoản',
        subtitle: 'Cập nhật thông tin người dùng và tùy chọn bảo mật',
        icon: <User theme='outline' size={16} fill='currentColor' />,
        action: () => {
          void navigate('/settings/personal');
          onClose();
        },
      },
      {
        id: 'action-store',
        category: 'action',
        title: 'Cửa hàng Gói & Ứng dụng (Store)',
        subtitle: 'Khám phá và tải về các gói ứng dụng, công cụ và giao diện',
        icon: <Gift theme='outline' size={16} fill='currentColor' />,
        action: () => {
          void navigate('/store');
          onClose();
        },
      },
      {
        id: 'action-models',
        category: 'action',
        title: 'Cấu hình Mô hình AI (Models)',
        subtitle: 'Quản lý API keys, provider local và cloud models',
        icon: <Robot theme='outline' size={16} fill='currentColor' />,
        action: () => {
          void navigate('/settings/model');
          onClose();
        },
      },
      {
        id: 'action-security',
        category: 'action',
        title: 'Bảo mật & Két an toàn SQLite Vault',
        subtitle: 'Quản lý quyền, kiểm soát egress và lịch sử bảo mật',
        icon: <Shield theme='outline' size={16} fill='currentColor' />,
        action: () => {
          void navigate('/settings/security');
          onClose();
        },
      },
      {
        id: 'action-restart',
        category: 'action',
        title: 'Khởi động lại Ứng dụng (Restart App)',
        subtitle: 'Tải lại toàn bộ tiến trình Electron khi gặp sự cố',
        icon: <Refresh theme='outline' size={16} fill='currentColor' />,
        action: () => {
          void ipcBridge.windowControls.restart.invoke();
          onClose();
        },
      },
    ],
    [navigate, onClose]
  );

  // Package Apps
  const packageItems = useMemo<SearchItem[]>(() => {
    return FIRST_PARTY_PACKAGE_CATALOG.map((entry) => ({
      id: `pkg-${entry.manifest.id}`,
      category: 'app' as SearchCategory,
      title: entry.manifest.name,
      subtitle: entry.manifest.description,
      icon: <AllApplication theme='outline' size={16} fill='currentColor' />,
      action: () => {
        if (entry.manifest.type === 'ui') {
          void navigate('/settings/display');
        } else {
          void navigate(`/apps/${entry.manifest.id}`);
        }
        onClose();
      },
    }));
  }, [navigate, onClose]);

  // Filtered results
  const filteredItems = useMemo<SearchItem[]>(() => {
    const trimmed = query.trim().toLowerCase();

    // 1. Conversations matching query
    const convItems: SearchItem[] = conversations
      .filter((c) => !trimmed || c.name?.toLowerCase().includes(trimmed))
      .slice(0, 15)
      .map((c) => ({
        id: `conv-${c.id}`,
        category: 'conversation',
        title: c.name || 'Cuộc trò chuyện chưa đặt tên',
        subtitle: `Hội thoại • ${new Date(c.modified_at || c.created_at || Date.now()).toLocaleDateString()}`,
        icon: <MessageOne theme='outline' size={16} fill='currentColor' />,
        action: () => {
          void navigate(`/conversation/${c.id}`);
          onClose();
        },
      }));

    // 2. Apps matching query
    const appItems = packageItems.filter(
      (item) => !trimmed || item.title.toLowerCase().includes(trimmed) || item.subtitle?.toLowerCase().includes(trimmed)
    );

    // 3. Actions matching query
    const actionItems = quickActions.filter(
      (item) => !trimmed || item.title.toLowerCase().includes(trimmed) || item.subtitle?.toLowerCase().includes(trimmed)
    );

    return [...convItems, ...appItems, ...actionItems];
  }, [conversations, packageItems, query, quickActions, navigate, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = filteredItems[selectedIndex];
        if (selected) {
          selected.action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [filteredItems, selectedIndex, onClose]
  );

  return (
    <Modal
      visible={visible}
      footer={null}
      closable={false}
      onCancel={onClose}
      wrapClassName='tomni-search-modal-wrap'
      style={{ width: '600px', maxWidth: '95vw', padding: 0, background: 'transparent' }}
      modalRender={() => (
        <div
          className='tomni-glass-panel'
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '80vh',
            borderRadius: '16px',
            overflow: 'hidden',
          }}
          onKeyDown={handleKeyDown}
        >
          {/* Search Input Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 18px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.03)',
            }}
          >
            <Search theme='outline' size={18} fill='#38bdf8' />
            <input
              ref={inputRef}
              type='text'
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder='Tìm kiếm hội thoại, ứng dụng, cài đặt... (↑↓ điều hướng, Enter chọn)'
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                color: '#f8fafc',
                fontSize: '14px',
                fontFamily: 'inherit',
              }}
            />
            {query && (
              <button
                type='button'
                onClick={() => setQuery('')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '2px',
                }}
              >
                <CloseSmall theme='outline' size={16} fill='currentColor' />
              </button>
            )}
            <kbd
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.12)',
              }}
            >
              ESC
            </kbd>
          </div>

          {/* Results List */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {filteredItems.length === 0 ? (
              <div
                style={{
                  padding: '36px 20px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '13px',
                }}
              >
                Không tìm thấy kết quả nào phù hợp với &quot;{query}&quot;
              </div>
            ) : (
              filteredItems.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    className='tomni-glass-item'
                    style={{
                      background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                      border: isSelected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
                      padding: '10px 12px',
                    }}
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className='tomni-glass-item-left'>
                      <span className='tomni-glass-item-icon' style={{ color: isSelected ? '#38bdf8' : '#94a3b8' }}>
                        {item.icon}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span
                          style={{
                            fontWeight: 600,
                            color: isSelected ? '#ffffff' : '#e2e8f0',
                            fontSize: '13px',
                          }}
                        >
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.3 }}>{item.subtitle}</span>
                        )}
                      </div>
                    </div>
                    {item.category === 'conversation' && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          color: '#94a3b8',
                        }}
                      >
                        Hội thoại
                      </span>
                    )}
                    {item.category === 'app' && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'rgba(37, 99, 235, 0.2)',
                          color: '#60a5fa',
                        }}
                      >
                        Ứng dụng
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    />
  );
};

export default GlobalSearchModal;
