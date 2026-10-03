/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Message, Modal, Spin, Tag } from '@arco-design/web-react';
import { Down, Gift, History, Plus, Refresh, Robot, Up } from '@icon-park/react';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import {
  fetchTomProfile,
  fetchTomTransactions,
  redeemTomCode,
  topUpTomBalance,
  type TomProfile,
  type TomTransaction,
} from '@/renderer/services/supabaseAuth';
import { TomCoinIcon } from './TomBalanceWidget';

interface TomWalletModalProps {
  visible: boolean;
  onClose: () => void;
}

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('vi-VN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

export const TomWalletModal: React.FC<TomWalletModalProps> = ({ visible, onClose }) => {
  const { user, ready } = useAuth();

  const [profile, setProfile] = useState<TomProfile | null>(null);
  const [transactions, setTransactions] = useState<TomTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [profData, txData] = await Promise.all([fetchTomProfile(user.id), fetchTomTransactions(user.id)]);
      if (profData) setProfile(profData);
      setTransactions(txData);
    } catch {
      // quiet
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (visible && ready && user?.id) {
      void loadData();
    }
  }, [visible, ready, user?.id, loadData]);

  const handleTopUp = async (amount: number) => {
    if (!user?.id) return;
    setTopUpLoading(true);
    try {
      const res = await topUpTomBalance(user.id, amount, 'Nạp tiền thử nghiệm');
      if (res.success) {
        Message.success(`Nạp thành công +${amount.toFixed(2)} TOM!`);
        void loadData();
      } else {
        Message.error(res.message || 'Nạp tiền thất bại.');
      }
    } catch {
      Message.error('Có lỗi xảy ra khi nạp TOM.');
    } finally {
      setTopUpLoading(false);
    }
  };

  const handleRedeem = async () => {
    if (!user?.id) return;
    if (!redeemCodeInput.trim()) {
      Message.warning('Vui lòng nhập mã quà tặng.');
      return;
    }

    setRedeemLoading(true);
    try {
      const res = await redeemTomCode(user.id, redeemCodeInput);
      if (res.success) {
        Message.success(res.message);
        setRedeemCodeInput('');
        void loadData();
      } else {
        Message.error(res.message);
      }
    } catch {
      Message.error('Không thể kiểm tra mã quà tặng.');
    } finally {
      setRedeemLoading(false);
    }
  };

  const balance = profile?.balance_tom ?? 5.0;

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={null}
      style={{ width: '640px', maxWidth: '92vw', borderRadius: '16px', overflow: 'hidden' }}
      className='tomni-glass-modal'
      wrapClassName='tomni-glass-modal-wrap'
    >
      <div style={{ padding: '4px' }}>
        {/* Header Section */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <TomCoinIcon size={26} />
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>Ví TOM & Sổ cái Giao dịch</span>
                <Tag color='gold' size='small' style={{ borderRadius: '6px' }}>
                  TOM Ledger
                </Tag>
              </h2>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Đơn vị tiền tệ tính toán tác vụ & dịch vụ AI trong TomniHubOS
              </span>
            </div>
          </div>

          <Button
            type='text'
            size='small'
            icon={<Refresh theme='outline' size={14} />}
            onClick={() => void loadData()}
            loading={loading}
          />
        </div>

        {/* Balance Showcase Card */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.08) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '14px',
            padding: '18px 20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 500 }}>SỐ DƯ HIỆN CÓ</span>
            <div
              style={{
                fontSize: '28px',
                fontWeight: 800,
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '2px',
              }}
            >
              <TomCoinIcon size={26} />
              <span>{balance.toFixed(4)} TOM</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              Tương đương ${balance.toFixed(2)} USD (1 TOM = $1.00 USD)
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <Tag color='green' size='small' style={{ borderRadius: '9999px', marginBottom: '6px' }}>
              ● Đang hoạt động
            </Tag>
            <div style={{ fontSize: '11px', color: '#64748b' }}>Cập nhật tự động (Realtime)</div>
          </div>
        </div>

        {/* Top-Up Test & Promo Code */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '20px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', marginBottom: '10px' }}>
            Nạp thêm TOM (Top-up test & Đổi mã)
          </div>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <Button
              type='outline'
              size='small'
              icon={<Plus theme='outline' size={13} />}
              loading={topUpLoading}
              onClick={() => void handleTopUp(10)}
              style={{ borderRadius: '8px' }}
            >
              +10 TOM ($10)
            </Button>
            <Button
              type='outline'
              size='small'
              icon={<Plus theme='outline' size={13} />}
              loading={topUpLoading}
              onClick={() => void handleTopUp(25)}
              style={{ borderRadius: '8px' }}
            >
              +25 TOM ($25)
            </Button>
            <Button
              type='outline'
              size='small'
              icon={<Plus theme='outline' size={13} />}
              loading={topUpLoading}
              onClick={() => void handleTopUp(50)}
              style={{ borderRadius: '8px' }}
            >
              +50 TOM ($50)
            </Button>
          </div>

          {/* Redeem Promo */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <Input
              size='small'
              prefix={<Gift theme='outline' size={14} />}
              placeholder='Nhập mã quà tặng (ví dụ: TOMNI2026, WELCOME50)'
              value={redeemCodeInput}
              onChange={setRedeemCodeInput}
              style={{ flex: 1, borderRadius: '8px' }}
            />
            <Button
              type='primary'
              size='small'
              loading={redeemLoading}
              onClick={handleRedeem}
              style={{
                borderRadius: '8px',
                background: '#f59e0b',
                border: 'none',
              }}
            >
              Đổi mã
            </Button>
          </div>
        </div>

        {/* Transaction History */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <History theme='outline' size={16} />
              <span>Lịch sử biến động số dư</span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>{transactions.length} giao dịch gần nhất</span>
          </div>

          <Spin loading={loading} style={{ width: '100%' }}>
            <div
              style={{
                maxHeight: '260px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingRight: '4px',
              }}
            >
              {transactions.length === 0 ? (
                <Empty description='Chưa có giao dịch nào ghi nhận' style={{ padding: '24px 0' }} />
              ) : (
                transactions.map((tx) => {
                  const isPositive = tx.amount >= 0;
                  return (
                    <div
                      key={tx.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background:
                              tx.type === 'spend'
                                ? 'rgba(239, 68, 68, 0.15)'
                                : tx.type === 'redeem'
                                  ? 'rgba(245, 158, 11, 0.15)'
                                  : 'rgba(16, 185, 129, 0.15)',
                            color: tx.type === 'spend' ? '#f87171' : tx.type === 'redeem' ? '#fbbf24' : '#34d399',
                          }}
                        >
                          {tx.type === 'spend' ? (
                            <Robot theme='outline' size={16} />
                          ) : tx.type === 'redeem' ? (
                            <Gift theme='outline' size={16} />
                          ) : isPositive ? (
                            <Up theme='outline' size={16} />
                          ) : (
                            <Down theme='outline' size={16} />
                          )}
                        </div>

                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#f1f5f9' }}>{tx.description}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            {formatDate(tx.created_at)} • Sau GD: {tx.balance_after.toFixed(2)} TOM
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: isPositive ? '#34d399' : '#f87171',
                        }}
                      >
                        {isPositive ? `+${tx.amount.toFixed(2)}` : `${tx.amount.toFixed(2)}`} TOM
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Spin>
        </div>
      </div>
    </Modal>
  );
};

export default TomWalletModal;
