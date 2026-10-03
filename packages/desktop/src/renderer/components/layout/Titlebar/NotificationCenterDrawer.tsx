/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Drawer, Tabs, Badge, Button, Tag, Empty, Message, Switch, Tooltip } from '@arco-design/web-react';
import {
  CheckOne,
  Clear,
  Delete,
  EmailSuccessfully,
  Lightning,
  Remind,
  Right,
  Robot,
  Time,
  Send,
  SettingTwo,
  Shield,
  Plus,
} from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import {
  notificationService,
  useNotifications,
  type AppNotification,
  type NotificationLevel,
  type NotificationSource,
} from '@/renderer/services/notificationService';
import { managerClient } from '@/renderer/pages/manager/managerBridgeClient';
import '@/renderer/styles/glassmorphism.css';

const { TabPane } = Tabs;

interface NotificationCenterDrawerProps {
  visible: boolean;
  onClose: () => void;
}

const LEVEL_TAG_MAP: Record<NotificationLevel, { color: string; label: string; bg: string; border: string }> = {
  P0: {
    color: '#ef4444',
    label: 'P0 • Khẩn Cấp',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.3)',
  },
  P1: {
    color: '#f59e0b',
    label: 'P1 • Trong Ngày',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  P2: {
    color: '#06b6d4',
    label: 'P2 • Tham Khảo',
    bg: 'rgba(6, 182, 212, 0.12)',
    border: 'rgba(6, 182, 212, 0.3)',
  },
  P3: {
    color: '#64748b',
    label: 'P3 • Tạp Âm',
    bg: 'rgba(100, 116, 139, 0.12)',
    border: 'rgba(100, 116, 139, 0.3)',
  },
};

const SOURCE_ICON_MAP: Record<NotificationSource, React.ReactNode> = {
  system: <Shield theme='outline' size={14} fill='#38bdf8' />,
  agent: <Robot theme='outline' size={14} fill='#a855f7' />,
  cron: <Time theme='outline' size={14} fill='#10b981' />,
  tom: <Lightning theme='outline' size={14} fill='#f59e0b' />,
  telegram: <Send theme='outline' size={14} fill='#0284c7' />,
  email: <EmailSuccessfully theme='outline' size={14} fill='#ef4444' />,
  zalo: <Send theme='outline' size={14} fill='#0068ff' />,
};

const formatTimeAgo = (ts: number): string => {
  const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h trước`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d trước`;
};

export const NotificationCenterDrawer: React.FC<NotificationCenterDrawerProps> = ({ visible, onClose }) => {
  const { notifications, unreadP0Count, unreadP1Count, markAsRead, markAllAsRead, remove, clearAll } =
    useNotifications();
  const [activeTab, setActiveTab] = useState<'focus' | 'digest' | 'connectors'>('focus');
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [zaloEnabled, setZaloEnabled] = useState(false);
  const navigate = useNavigate();

  // Listen for global open event
  useEffect(() => {
    const handleOpen = () => {
      // already controlled by parent, but can dispatch
    };
    window.addEventListener('tomni-open-notifications', handleOpen);
    return () => window.removeEventListener('tomni-open-notifications', handleOpen);
  }, []);

  const focusNotifications = useMemo(() => {
    return notifications.filter((n) => n.level === 'P0' || n.level === 'P1');
  }, [notifications]);

  const digestNotifications = useMemo(() => {
    return notifications.filter((n) => n.level === 'P2');
  }, [notifications]);

  const handleCreateTask = useCallback(
    async (item: AppNotification) => {
      try {
        await managerClient.addTask({
          input: {
            title: `[Thông báo] ${item.title}`,
            description: item.message,
            priority: item.level === 'P0' ? 'urgent' : 'medium',
          },
        });
        markAsRead(item.id);
        Message.success('Đã tạo công việc thành công trong Trung tâm Quản lý');
      } catch (error) {
        Message.error(`Không thể tạo công việc: ${String(error)}`);
      }
    },
    [markAsRead]
  );

  const handleAction = useCallback(
    (item: AppNotification) => {
      markAsRead(item.id);
      if (item.actionUrl) {
        onClose();
        navigate(item.actionUrl);
      }
    },
    [markAsRead, navigate, onClose]
  );

  return (
    <Drawer
      width={460}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Remind theme='outline' size={18} fill='#38bdf8' />
            <span style={{ fontWeight: 700, fontSize: '15px' }}>Trung Tâm Thông Báo</span>
            <Tag
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 600,
                padding: '0 8px',
                height: '20px',
                lineHeight: '18px',
              }}
            >
              ⚡ Laya ~33ms
            </Tag>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Tooltip content='Đánh dấu tất cả đã đọc'>
              <Button
                type='text'
                size='mini'
                icon={<CheckOne theme='outline' size={14} />}
                onClick={() => {
                  markAllAsRead();
                  Message.success('Đã đánh dấu đã đọc');
                }}
              />
            </Tooltip>
            <Tooltip content='Xoá tất cả'>
              <Button
                type='text'
                size='mini'
                status='danger'
                icon={<Delete theme='outline' size={14} />}
                onClick={() => {
                  clearAll();
                  Message.info('Đã dọn sạch thông báo');
                }}
              />
            </Tooltip>
          </div>
        </div>
      }
      visible={visible}
      onCancel={onClose}
      footer={null}
      className='tomni-glass-panel'
      style={{
        backdropFilter: 'blur(28px) saturate(190%)',
        background: 'rgba(15, 23, 42, 0.92)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
      }}
    >
      <Tabs
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab as any)}
        type='rounded'
        size='small'
        style={{ marginBottom: '16px' }}
      >
        <TabPane
          key='focus'
          title={
            <span>
              Tiêu Điểm
              {unreadP0Count + unreadP1Count > 0 && (
                <Badge
                  count={unreadP0Count + unreadP1Count}
                  style={{
                    marginLeft: '6px',
                    backgroundColor: unreadP0Count > 0 ? '#ef4444' : '#f59e0b',
                  }}
                />
              )}
            </span>
          }
        >
          {/* Laya Summary Card */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              marginBottom: '14px',
              fontSize: '12px',
              lineHeight: 1.5,
              color: '#cbd5e1',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 600,
                color: '#38bdf8',
                marginBottom: '4px',
              }}
            >
              <Lightning theme='outline' size={14} fill='#38bdf8' />
              <span>Tóm tắt tức thì từ Laya Decision Engine:</span>
            </div>
            {focusNotifications.length > 0
              ? `Bạn có ${focusNotifications.length} thông báo quan trọng cần chú ý. Laya đã tự động phân luồng và bảo vệ quyền riêng tư 100% cục bộ.`
              : 'Tất cả các kênh đang yên tĩnh. Không có thông báo khẩn cấp nào cần can thiệp.'}
          </div>

          {focusNotifications.length === 0 ? (
            <Empty description='Không có thông báo tiêu điểm nào' style={{ marginTop: '40px' }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {focusNotifications.map((item) => {
                const levelConfig = LEVEL_TAG_MAP[item.level];
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      background: item.read ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.07)',
                      border:
                        item.level === 'P0'
                          ? '1px solid rgba(239, 68, 68, 0.35)'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                      boxShadow: item.level === 'P0' ? '0 0 12px rgba(239, 68, 68, 0.15)' : 'none',
                      transition: 'all 0.2s ease',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {SOURCE_ICON_MAP[item.source]}
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: levelConfig.bg,
                            border: `1px solid ${levelConfig.border}`,
                            color: levelConfig.color,
                          }}
                        >
                          {levelConfig.label}
                        </span>
                      </div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{formatTimeAgo(item.timestamp)}</span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc', marginBottom: '4px' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.45, marginBottom: '8px' }}>
                      {item.message}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                        paddingTop: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {item.actionUrl && (
                          <Button
                            type='primary'
                            size='mini'
                            style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
                            onClick={() => handleAction(item)}
                          >
                            {item.actionLabel || 'Xem chi tiết'}
                          </Button>
                        )}
                        <Button
                          type='secondary'
                          size='mini'
                          style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
                          onClick={() => handleCreateTask(item)}
                        >
                          + Tạo Task
                        </Button>
                      </div>
                      <Button
                        type='text'
                        size='mini'
                        style={{ fontSize: '11px', color: '#64748b' }}
                        onClick={() => remove(item.id)}
                      >
                        Bỏ qua
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabPane>

        <TabPane key='digest' title='Bản Tin Gom Cụm (P2)'>
          {digestNotifications.length === 0 ? (
            <Empty description='Không có tin tức gom cụm' style={{ marginTop: '40px' }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {digestNotifications.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {SOURCE_ICON_MAP[item.source]}
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>{item.title}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>{formatTimeAgo(item.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>{item.message}</div>
                </div>
              ))}
            </div>
          )}
        </TabPane>

        <TabPane key='connectors' title='Kênh & Kết Nối'>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
              Quản lý các nguồn dữ liệu thông báo. Laya Decision Engine sẽ xử lý cục bộ và loại bỏ tạp âm tự động.
            </div>

            {/* Internal Connectors */}
            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc', marginBottom: '8px' }}>
                Kênh Hệ Thống Nội Bộ
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#cbd5e1' }}>🤖 Tác vụ AI Agent & Chat</span>
                  <Tag color='green' size='small'>
                    Đang bật
                  </Tag>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#cbd5e1' }}>⏰ Lập lịch Cron Jobs</span>
                  <Tag color='green' size='small'>
                    Đang bật
                  </Tag>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#cbd5e1' }}>🪙 Biến động Số dư Ví TOM</span>
                  <Tag color='green' size='small'>
                    Đang bật
                  </Tag>
                </div>
              </div>
            </div>

            {/* External Connectors */}
            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc', marginBottom: '8px' }}>
                Kênh Mạng Xã Hội & Ngoại Vi
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 500 }}>✈️ Telegram Bot Bridge</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Nhận cảnh báo từ bot/channel</div>
                  </div>
                  <Switch
                    size='small'
                    checked={telegramEnabled}
                    onChange={(val) => {
                      setTelegramEnabled(val);
                      Message.info(val ? 'Đã bật kênh Telegram' : 'Đã tạm dừng kênh Telegram');
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 500 }}>✉️ Hòm Thư Email (IMAP)</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Tự động lọc email khẩn cấp / OTP</div>
                  </div>
                  <Switch
                    size='small'
                    checked={emailEnabled}
                    onChange={(val) => {
                      setEmailEnabled(val);
                      Message.info(val ? 'Đã bật kênh Email' : 'Đã tạm dừng kênh Email');
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 500 }}>
                      💬 Zalo & Messenger Mirror
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Kết nối qua Tomni Companion</div>
                  </div>
                  <Switch
                    size='small'
                    checked={zaloEnabled}
                    onChange={(val) => {
                      setZaloEnabled(val);
                      Message.info(val ? 'Đã kích hoạt Zalo Mirror' : 'Đã tắt Zalo Mirror');
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </TabPane>
      </Tabs>
    </Drawer>
  );
};

export default NotificationCenterDrawer;
