/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Button,
  Card,
  Tag,
  Switch,
  Space,
  Typography,
  Divider,
  Message,
  Modal,
  Radio,
  Spin,
} from '@arco-design/web-react';
import { Left, Right, Delete, Setting, Plus, Shield, Book, Lightning, FileCode, Connection } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type {
  ChatPipelineDefinition,
  ChatPipelineStageRef,
  ChatStageMetadata,
  PipelineSimulationResult,
  StagePhase,
} from '@/common/types/pipeline';
import { iconColors } from '@/renderer/styles/colors';

const { Title, Text, Paragraph } = Typography;

export type ChatPipelineDrawerProps = {
  visible: boolean;
  onClose: () => void;
  conversationId?: string;
  onPipelineUpdated?: (activeCount: number) => void;
};

const PHASE_TAG_COLORS: Record<StagePhase, string> = {
  pre_query: 'green',
  retrieve: 'arcoblue',
  pre_model: 'orange',
  post_model: 'purple',
};

const PHASE_LABELS: Record<StagePhase, string> = {
  pre_query: 'Tiền Trạm (Pre-query)',
  retrieve: 'Tri Thức / RAG (Retrieve)',
  pre_model: 'Điều Phối Công Cụ (Pre-model)',
  post_model: 'Hậu Xử Lý (Post-model)',
};

const getStageIcon = (iconName?: string) => {
  switch (iconName) {
    case 'Shield':
      return <Shield theme='filled' size='18' fill='#52c41a' />;
    case 'Book':
      return <Book theme='filled' size='18' fill='#165dff' />;
    case 'Wrench':
    case 'Lightning':
      return <Lightning theme='filled' size='18' fill='#ff7d00' />;
    case 'FileCode':
      return <FileCode theme='filled' size='18' fill='#722ed1' />;
    default:
      return <Connection theme='outline' size='18' fill={iconColors.primary} />;
  }
};

export const ChatPipelineDrawer: React.FC<ChatPipelineDrawerProps> = ({
  visible,
  onClose,
  conversationId,
  onPipelineUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableStages, setAvailableStages] = useState<ChatStageMetadata[]>([]);
  const [definition, setDefinition] = useState<ChatPipelineDefinition | null>(null);

  // Dry-run simulation state
  const [simulation, setSimulation] = useState<PipelineSimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Settings modal state
  const [selectedConfigStage, setSelectedConfigStage] = useState<ChatPipelineStageRef | null>(null);
  const [layaMode, setLayaMode] = useState<'rewrite' | 'block'>('rewrite');

  const loadPipelineData = useCallback(async () => {
    setLoading(true);
    try {
      const [stages, def] = await Promise.all([
        ipcBridge.conversation.getPipelineAvailableStages.invoke(),
        ipcBridge.conversation.getPipelineDefinition.invoke({ conversation_id: conversationId }),
      ]);
      setAvailableStages(stages);
      setDefinition(def);
      const activeCount = def.stages.filter((s) => s.enabled).length;
      onPipelineUpdated?.(activeCount);
    } catch (error) {
      console.error('[ChatPipelineDrawer] Load error:', error);
      Message.error('Không thể tải cấu hình Chat Pipeline.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, onPipelineUpdated]);

  useEffect(() => {
    if (visible) {
      void loadPipelineData();
    }
  }, [visible, loadPipelineData]);

  // Automatic Background Health Probe Simulation on definition changes (debounced 250ms)
  useEffect(() => {
    if (!definition || !visible) return;
    let isCancelled = false;
    setIsSimulating(true);

    const timer = setTimeout(async () => {
      try {
        const result = await ipcBridge.conversation.simulatePipeline.invoke({
          definition,
          probe_query: 'Dry-run preflight probe query: ping health check',
        });
        if (!isCancelled) {
          setSimulation(result);
        }
      } catch (err) {
        console.warn('[ChatPipelineDrawer] Simulation probe failed:', err);
        if (!isCancelled) {
          setSimulation({
            success: false,
            totalDurationMs: 0,
            initialContextBytes: 0,
            finalContextBytes: 0,
            addedContextBytes: 0,
            finalQuery: '',
            stageMetrics: [],
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!isCancelled) {
          setIsSimulating(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [definition, visible]);

  // Helper to find metric for a stage
  const getStageMetric = (stageId: string) => {
    return simulation?.stageMetrics.find((m) => m.stageId === stageId);
  };

  // Handle stage reordering
  const moveStage = (index: number, direction: 'left' | 'right') => {
    if (!definition) return;
    const newStages = [...definition.stages];
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newStages.length) return;

    const temp = newStages[index];
    newStages[index] = newStages[targetIndex];
    newStages[targetIndex] = temp;

    setDefinition({ ...definition, stages: newStages });
  };

  // Handle stage enable/disable toggle
  const toggleStage = (index: number, enabled: boolean) => {
    if (!definition) return;
    const newStages = [...definition.stages];
    newStages[index] = { ...newStages[index], enabled };
    setDefinition({ ...definition, stages: newStages });
  };

  // Handle stage removal
  const removeStage = (index: number) => {
    if (!definition) return;
    const newStages = definition.stages.filter((_, i) => i !== index);
    setDefinition({ ...definition, stages: newStages });
  };

  // Handle adding stage from available palette
  const addStageToPipeline = (meta: ChatStageMetadata) => {
    if (!definition) return;
    const newStageRef: ChatPipelineStageRef = {
      id: `stage-${meta.id}-${Date.now()}`,
      stageRegistryId: meta.id,
      phase: meta.phase,
      enabled: true,
      config: meta.defaultConfig,
    };
    setDefinition({
      ...definition,
      stages: [...definition.stages, newStageRef],
    });
    Message.success(`Đã thêm ${meta.displayName} vào dây chuyền`);
  };

  // Save pipeline configuration
  const handleSave = async () => {
    if (!definition) return;
    setSaving(true);
    try {
      await ipcBridge.conversation.updatePipelineDefinition.invoke({
        conversation_id: conversationId,
        definition,
      });
      const activeCount = definition.stages.filter((s) => s.enabled).length;
      onPipelineUpdated?.(activeCount);
      Message.success('Đã lưu cấu hình Chat Pipeline thành công!');
      onClose();
    } catch (error) {
      console.error('[ChatPipelineDrawer] Save error:', error);
      Message.error('Không thể lưu cấu hình Pipeline.');
    } finally {
      setSaving(false);
    }
  };

  // Reset to system default
  const handleReset = async () => {
    if (!definition) return;
    const defaultStages: ChatPipelineStageRef[] = [
      { id: 'stage-laya', stageRegistryId: 'builtin:laya-security', phase: 'pre_query', enabled: true },
      { id: 'stage-rtk', stageRegistryId: 'builtin:rtk-knowledge', phase: 'retrieve', enabled: false },
      { id: 'stage-tool', stageRegistryId: 'builtin:tool-router', phase: 'pre_model', enabled: true },
    ];
    setDefinition({ ...definition, stages: defaultStages });
    Message.info('Đã khôi phục cấu hình mặc định (bấm Lưu để áp dụng).');
  };

  // Save stage config modal
  const handleSaveStageConfig = () => {
    if (!definition || !selectedConfigStage) return;
    const newStages = definition.stages.map((st) => {
      if (st.id === selectedConfigStage.id) {
        return { ...st, config: { ...st.config, mode: layaMode } };
      }
      return st;
    });
    setDefinition({ ...definition, stages: newStages });
    setSelectedConfigStage(null);
    Message.success('Đã cập nhật tùy chọn chặng.');
  };

  const activeStageRegistryIds = useMemo(() => {
    return new Set(definition?.stages.map((s) => s.stageRegistryId) ?? []);
  }, [definition]);

  const paletteStages = useMemo(() => {
    return availableStages.filter((st) => !activeStageRegistryIds.has(st.id));
  }, [availableStages, activeStageRegistryIds]);

  return (
    <>
      <Drawer
        width={720}
        title={
          <Space>
            <Connection theme='filled' size='20' fill={iconColors.primary} />
            <Text bold style={{ fontSize: 16 }}>
              Visual Chat Pipeline Builder
            </Text>
          </Space>
        }
        visible={visible}
        onCancel={onClose}
        footer={
          <div className='flex justify-between items-center w-full'>
            <Button type='secondary' onClick={handleReset}>
              Khôi phục mặc định
            </Button>
            <Space>
              <Button onClick={onClose}>Hủy</Button>
              <Button type='primary' loading={saving} onClick={handleSave}>
                Lưu Dây Chuyền
              </Button>
            </Space>
          </div>
        }
      >
        <Spin loading={loading} style={{ width: '100%' }}>
          <Paragraph type='secondary' className='mb-4'>
            Tự do sắp xếp thứ tự, thêm package từ Store (như Context7), bật/tắt chặng xử lý câu hỏi trước khi gửi tới
            LLM.
          </Paragraph>

          {/* ---------------- ACTIVE PIPELINE TRACK ---------------- */}
          <div className='mb-6'>
            <div className='flex justify-between items-center mb-3'>
              <Title heading={6} style={{ margin: 0 }}>
                Dây Chuyền Đang Kích Hoạt (Execution Sequence)
              </Title>
              <Tag color='blue'>{definition?.stages.length ?? 0} Chặng</Tag>
            </div>

            {/* Pre-flight Dry-run Simulation Status Banner */}
            {isSimulating ? (
              <div className='mb-3 p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between'>
                <Space>
                  <Spin size={14} />
                  <Text style={{ fontSize: 13, color: '#165dff' }}>
                    Đang chạy ngầm mô phỏng kiểm thử an toàn (Preflight Health Probe)...
                  </Text>
                </Space>
                <Tag size='small' color='arcoblue'>
                  Đang Kiểm Tra
                </Tag>
              </div>
            ) : simulation ? (
              simulation.success ? (
                <div className='mb-3 p-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center justify-between'>
                  <div>
                    <Space>
                      <Text bold style={{ fontSize: 13, color: '#00b42a' }}>
                        ✓ Dây Chuyền Hoạt Động Khỏe Mạnh
                      </Text>
                      <Tag size='small' color='green'>
                        Health OK
                      </Tag>
                    </Space>
                    <div className='text-xs text-gray-500 mt-0.5'>
                      ⏱️ Ước tính độ trễ: ~{simulation.totalDurationMs}ms • Context tích lũy: +
                      {simulation.addedContextBytes} B (~{Math.ceil(simulation.addedContextBytes / 4)} tokens)
                    </div>
                  </div>
                  <Tag size='small' color='cyan'>
                    {simulation.stageMetrics.filter((m) => m.decision !== 'skip').length} Chặng Pass
                  </Tag>
                </div>
              ) : (
                <div className='mb-3 p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg flex items-center justify-between'>
                  <div>
                    <Text bold style={{ fontSize: 13, color: '#f53f3f' }}>
                      ⚠️ Phát hiện lỗi mô phỏng ngầm
                    </Text>
                    <div className='text-xs text-red-500 mt-0.5'>
                      {simulation.errorMessage || 'Kiểm thử chặng không đạt tiêu chuẩn.'}
                    </div>
                  </div>
                  <Tag size='small' color='red'>
                    Mô Phỏng Thất Bại
                  </Tag>
                </div>
              )
            ) : null}

            <div className='bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700'>
              {/* Start Node */}
              <div className='p-2 mb-2 bg-white dark:bg-gray-900 rounded border border-dashed border-gray-300 flex items-center justify-between'>
                <Space>
                  <Tag color='cyan'>Bắt Đầu</Tag>
                  <Text bold>💬 Câu Hỏi Người Dùng (User Query)</Text>
                </Space>
                <Text type='secondary' style={{ fontSize: 12 }}>
                  Đầu vào gốc
                </Text>
              </div>

              {/* Stages Track */}
              {definition?.stages.map((stageRef, index) => {
                const meta = availableStages.find((s) => s.id === stageRef.stageRegistryId);
                const displayName = meta?.displayName ?? stageRef.stageRegistryId;

                return (
                  <div key={stageRef.id} className='relative my-2'>
                    <div className='flex justify-center my-1'>
                      <Text type='secondary' style={{ fontSize: 14 }}>
                        ⬇️
                      </Text>
                    </div>
                    <Card
                      size='small'
                      className={`border transition-all ${
                        stageRef.enabled
                          ? 'border-blue-300 dark:border-blue-700 shadow-sm'
                          : 'border-gray-300 opacity-60'
                      }`}
                      style={{ background: stageRef.enabled ? undefined : '#f5f5f5' }}
                    >
                      <div className='flex items-center justify-between'>
                        <Space>
                          <span className='font-mono text-xs text-gray-400'>#{index + 1}</span>
                          {getStageIcon(meta?.icon)}
                          <div>
                            <div className='flex items-center space-x-2'>
                              <Text bold>{displayName}</Text>
                              <Tag size='small' color={PHASE_TAG_COLORS[stageRef.phase]}>
                                {stageRef.phase}
                              </Tag>
                              {meta?.isBuiltin ? (
                                <Tag size='small'>Built-in</Tag>
                              ) : (
                                <Tag size='small' color='arcoblue'>
                                  Store Package
                                </Tag>
                              )}
                            </div>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                              {meta?.description ?? 'Tùy biến xử lý tin nhắn'}
                            </Text>
                          </div>
                        </Space>

                        {/* Card Controls */}
                        <Space size='mini'>
                          <Button
                            size='mini'
                            type='text'
                            disabled={index === 0}
                            onClick={() => moveStage(index, 'left')}
                            icon={<Left size='14' />}
                            title='Chuyển lên trước'
                          />
                          <Button
                            size='mini'
                            type='text'
                            disabled={index === (definition?.stages.length ?? 0) - 1}
                            onClick={() => moveStage(index, 'right')}
                            icon={<Right size='14' />}
                            title='Chuyển ra sau'
                          />
                          {stageRef.stageRegistryId.includes('security') && (
                            <Button
                              size='mini'
                              type='text'
                              onClick={() => {
                                setSelectedConfigStage(stageRef);
                                setLayaMode((stageRef.config?.mode as 'rewrite' | 'block') ?? 'rewrite');
                              }}
                              icon={<Setting size='14' />}
                              title='Cài đặt chặng'
                            />
                          )}
                          <Switch size='small' checked={stageRef.enabled} onChange={(val) => toggleStage(index, val)} />
                          <Button
                            size='mini'
                            type='text'
                            status='danger'
                            onClick={() => removeStage(index)}
                            icon={<Delete size='14' />}
                            title='Gỡ khỏi dây chuyền'
                          />
                        </Space>
                      </div>

                      {/* Stage Probe Metrics */}
                      {stageRef.enabled && (
                        <div className='mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs'>
                          <Space size='mini'>
                            {(() => {
                              const metric = getStageMetric(stageRef.id);
                              if (!metric) {
                                return isSimulating ? (
                                  <Text type='secondary' style={{ fontSize: 11 }}>
                                    Đang probe...
                                  </Text>
                                ) : (
                                  <Text type='secondary' style={{ fontSize: 11 }}>
                                    Chưa có số liệu
                                  </Text>
                                );
                              }
                              if (metric.status === 'error') {
                                return (
                                  <Tag size='small' color='red'>
                                    Lỗi: {metric.error || 'Thất bại'}
                                  </Tag>
                                );
                              }
                              return (
                                <>
                                  <Tag size='small' color='cyan'>
                                    ⏱️ ~{metric.durationMs}ms
                                  </Tag>
                                  {metric.addedContextBytes > 0 && (
                                    <Tag size='small' color='arcoblue'>
                                      +{metric.addedContextBytes}B ctx
                                    </Tag>
                                  )}
                                  {metric.decision === 'rewrite' && (
                                    <Tag size='small' color='gold'>
                                      Auto-Rewrite
                                    </Tag>
                                  )}
                                  {metric.decision === 'continue' && (
                                    <Tag size='small' color='green'>
                                      Pass
                                    </Tag>
                                  )}
                                </>
                              );
                            })()}
                          </Space>
                          <Text type='secondary' style={{ fontSize: 11 }}>
                            {meta?.phase === 'pre_query'
                              ? 'Kiểm duyệt đầu vào'
                              : meta?.phase === 'retrieve'
                                ? 'Đo đạc Context RAG'
                                : meta?.phase === 'pre_model'
                                  ? 'Điều phối MCP Tool'
                                  : 'Chuẩn hóa phản hồi'}
                          </Text>
                        </div>
                      )}
                    </Card>
                  </div>
                );
              })}

              {/* End Node */}
              <div className='flex justify-center my-1'>
                <Text type='secondary' style={{ fontSize: 14 }}>
                  ⬇️
                </Text>
              </div>
              <div className='p-2 mt-2 bg-white dark:bg-gray-900 rounded border border-dashed border-gray-300 flex items-center justify-between'>
                <Space>
                  <Tag color='purple'>Đích Đến</Tag>
                  <Text bold>🤖 Cloud LLM Execution (Claude / GPT / Gemini)</Text>
                </Space>
                <Text type='secondary' style={{ fontSize: 12 }}>
                  Truyền an toàn qua TrustBroker
                </Text>
              </div>
            </div>
          </div>

          <Divider />

          {/* ---------------- AVAILABLE STAGES PALETTE ---------------- */}
          <div>
            <Title heading={6} className='mb-2'>
              Kho Stage Khả Dụng (Thêm vào Dây Chuyền)
            </Title>
            <Paragraph type='secondary' className='mb-3' style={{ fontSize: 12 }}>
              Các chặng Built-in hoặc Package tải từ Store đã sẵn sàng trên máy để kéo thả vào pipeline:
            </Paragraph>

            {paletteStages.length === 0 ? (
              <div className='p-4 text-center border border-dashed rounded text-gray-400'>
                Toàn bộ các stage khả dụng đã được đưa vào dây chuyền.
              </div>
            ) : (
              <div className='grid grid-cols-1 gap-2'>
                {paletteStages.map((meta) => (
                  <Card key={meta.id} size='small' className='hover:border-blue-400 transition-colors'>
                    <div className='flex items-center justify-between'>
                      <Space>
                        {getStageIcon(meta.icon)}
                        <div>
                          <div className='flex items-center space-x-2'>
                            <Text bold>{meta.displayName}</Text>
                            <Tag size='small' color={PHASE_TAG_COLORS[meta.phase]}>
                              {PHASE_LABELS[meta.phase]}
                            </Tag>
                            {meta.isBuiltin ? (
                              <Tag size='small'>Built-in</Tag>
                            ) : (
                              <Tag size='small' color='arcoblue'>
                                Store Package
                              </Tag>
                            )}
                          </div>
                          <Text type='secondary' style={{ fontSize: 12 }}>
                            {meta.description}
                          </Text>
                        </div>
                      </Space>
                      <Button
                        size='small'
                        type='outline'
                        icon={<Plus size='14' />}
                        onClick={() => addStageToPipeline(meta)}
                      >
                        Thêm vào Chuỗi
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Context7 Promotion / Store Hint */}
            <div className='mt-4 p-3 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 flex items-center justify-between'>
              <Space>
                <FileCode theme='filled' size='20' fill='#165dff' />
                <div>
                  <Text bold style={{ fontSize: 13 }}>
                    Khám phá thêm Chat Stage Packages trên Store
                  </Text>
                  <div className='text-xs text-gray-500'>
                    Tải thêm Context7 Docs, Web Search RAG, Prompt Optimizer từ chợ ứng dụng TomniHubOS Store.
                  </div>
                </div>
              </Space>
              <Button size='small' type='primary'>
                Mở Store
              </Button>
            </div>
          </div>
        </Spin>
      </Drawer>

      {/* Stage Settings Modal (e.g. Laya mode) */}
      <Modal
        title='Cấu Hình Chặng Bảo Mật Laya'
        visible={selectedConfigStage !== null}
        onOk={handleSaveStageConfig}
        onCancel={() => setSelectedConfigStage(null)}
      >
        <div className='space-y-4'>
          <Paragraph>
            Lựa chọn hành vi xử lý khi Laya Decision Engine phát hiện rò rỉ mật khẩu, thông tin cá nhân (PII):
          </Paragraph>
          <Radio.Group
            direction='vertical'
            value={layaMode}
            onChange={(val) => setLayaMode(val as 'rewrite' | 'block')}
          >
            <Radio value='rewrite'>
              <Space direction='vertical' size='mini'>
                <Text bold>Tự động che giấu (REWRITE) - Khuyên Dùng</Text>
                <Text type='secondary' style={{ fontSize: 12 }}>
                  Tự động thay thế mật khẩu/PII bằng [REDACTED] và tiếp tục gửi lên Cloud LLM mà không ngắt luồng.
                </Text>
              </Space>
            </Radio>
            <Radio value='block'>
              <Space direction='vertical' size='mini'>
                <Text bold>Chặn đứng hoàn toàn (BLOCK)</Text>
                <Text type='secondary' style={{ fontSize: 12 }}>
                  Dừng lượt chat ngay lập tức nếu phát hiện bất kỳ chuỗi nhạy cảm nào.
                </Text>
              </Space>
            </Radio>
          </Radio.Group>
        </div>
      </Modal>
    </>
  );
};
