/**
 * @license
 * Copyright 2026 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Card, Message, Progress, Tag, Tooltip } from '@arco-design/web-react';
import { IconCheckCircle, IconClockCircle, IconFolder, IconLoading } from '@arco-design/web-react/icon';
import { Copy, Download, Lightning, Shield } from '@icon-park/react';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { ipcBridge } from '@/common';
import TomnySteps from '@/renderer/components/base/TomnySteps';

export interface ParsedStep {
  index: number;
  total: number;
  title: string;
  description: string;
  completed: boolean;
  inProgress: boolean;
}

export interface ParsedStepProgress {
  headerTitle: string;
  target?: string;
  steps: ParsedStep[];
  progressPercent: number;
  isComplete: boolean;
  artifactPath?: string;
  packageId?: string;
  packageVersion?: string;
  isZeroToken: boolean;
  remainingText: string;
}

/**
 * Parses markdown step patterns (e.g. `- [x] Bước 1/4: ...`) and package output metadata.
 */
export function parseStepProgress(content: string): ParsedStepProgress | null {
  if (!content || typeof content !== 'string') return null;

  const lines = content.split(/\r?\n/);
  const stepLines: { lineIndex: number; mark: string; stepNum?: number; total?: number; desc: string }[] = [];

  const stepRegex = /^[-*]\s*\[([ xX/])\]\s*(?:(?:Bước|Step)\s*(\d+)(?:\/(\d+))?[:.]?\s*)?(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(stepRegex);
    if (match) {
      stepLines.push({
        lineIndex: i,
        mark: match[1],
        stepNum: match[2] ? parseInt(match[2], 10) : undefined,
        total: match[3] ? parseInt(match[3], 10) : undefined,
        desc: match[4] || '',
      });
    }
  }

  if (stepLines.length < 2) {
    return null;
  }

  const totalSteps = stepLines.length;
  let completedCount = 0;

  const steps: ParsedStep[] = stepLines.map((item, idx) => {
    const isCompleted = item.mark.toLowerCase() === 'x';
    if (isCompleted) completedCount++;
    const stepNum = item.stepNum ?? idx + 1;

    return {
      index: stepNum,
      total: totalSteps,
      title: `Bước ${stepNum}/${totalSteps}`,
      description: item.desc.trim(),
      completed: isCompleted,
      inProgress: false,
    };
  });

  let activeIndex = steps.findIndex((s) => !s.completed);
  if (activeIndex !== -1) {
    steps[activeIndex].inProgress = true;
  }

  const isComplete = completedCount === totalSteps;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  // Extract title / target
  let headerTitle = 'Quy trình thực thi';
  if (content.includes('[RepoToPackage]')) {
    headerTitle = 'RepoToPackage: Đóng gói tự động';
  } else if (content.includes('Static Guardrail') || content.includes('Laya')) {
    headerTitle = 'Laya Pipeline: Kiểm duyệt & Xác thực';
  }

  let target: string | undefined;
  const targetMatch = content.match(/🎯\s*Mục tiêu:\s*[`']?([^`'\n\r]+)[`']?/i);
  if (targetMatch) {
    target = targetMatch[1].trim();
  }

  // Extract artifact path
  let artifactPath: string | undefined;
  const artifactMatch = content.match(/[`']?([^`'\n\r\t()]+\.tomny)[`']?/i);
  if (artifactMatch) {
    artifactPath = artifactMatch[1].trim();
  }

  // Extract package ID and version
  let packageId: string | undefined;
  let packageVersion: string | undefined;
  const idMatch = content.match(/ID gói:\s*[`']?([^`'\s\n\r()]+)[`']?/i);
  if (idMatch) packageId = idMatch[1];
  const versionMatch = content.match(/v([0-9.]+)/i);
  if (versionMatch) packageVersion = versionMatch[1];

  const isZeroToken =
    content.includes('Zero-Token') || content.includes('không cần gọi LLM API') || content.includes('RepoToPackage');

  // Keep remaining non-step text to display below or inside
  const firstStepLine = stepLines[0].lineIndex;
  const lastStepLine = stepLines[stepLines.length - 1].lineIndex;
  const remainingLines = lines.filter((_, idx) => idx < firstStepLine || idx > lastStepLine);
  const remainingText = remainingLines.join('\n').trim();

  return {
    headerTitle,
    target,
    steps,
    progressPercent,
    isComplete,
    artifactPath,
    packageId,
    packageVersion,
    isZeroToken,
    remainingText,
  };
}

export const StepProgressVisualizer: React.FC<{
  data: ParsedStepProgress;
}> = ({ data }) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeStepIdx = useMemo(() => {
    const idx = data.steps.findIndex((s) => s.inProgress);
    if (idx !== -1) return idx;
    if (data.isComplete) return data.steps.length;
    return 0;
  }, [data.steps, data.isComplete]);

  const handleRevealFile = async () => {
    if (!data.artifactPath) return;
    try {
      await ipcBridge.shell.showItemInFolder.invoke(data.artifactPath);
    } catch {
      Message.warning('Không thể mở trực tiếp thư mục tệp');
    }
  };

  const handleCopyPath = async () => {
    if (!data.artifactPath) return;
    try {
      await copyText(data.artifactPath);
      setCopied(true);
      Message.success('Đã sao chép đường dẫn gói vào bộ nhớ tạm');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Message.error('Không thể sao chép đường dẫn');
    }
  };

  const handleInstallPackage = async () => {
    if (!data.artifactPath) return;
    setIsInstalling(true);
    try {
      const packageId = data.packageId || 'tomny-package';
      await ipcBridge.packagePlatform.install.invoke({
        packageId,
        archivePath: data.artifactPath,
      } as any);
      Message.success(`Cài đặt gói ${packageId} thành công!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Message.error(`Cài đặt gói thất bại: ${msg}`);
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div
      className='my-10px w-full max-w-780px rd-16px border border-border-2 bg-bg-2 p-16px shadow-sm transition-all'
      data-testid='step-progress-visualizer'
    >
      {/* Header bar */}
      <div className='flex flex-wrap items-center justify-between gap-10px border-b border-border-1 pb-12px'>
        <div className='flex items-center gap-8px'>
          <div className='flex size-26px items-center justify-center rd-8px bg-blue-500/10 text-blue-500'>
            <Shield theme='outline' size='16' />
          </div>
          <div className='flex flex-col'>
            <span className='text-14px font-700 text-t-primary leading-tight'>{data.headerTitle}</span>
            {data.target && (
              <span className='text-12px text-t-tertiary mt-2px'>
                Mục tiêu: <code className='bg-fill-2 px-4px py-1px rd-4px text-11px'>{data.target}</code>
              </span>
            )}
          </div>
        </div>

        <div className='flex items-center gap-8px'>
          {data.isZeroToken && (
            <Tag color='green' size='small' className='flex items-center gap-4px font-600'>
              <Lightning theme='filled' size='12' />
              <span>Zero-Token (No LLM)</span>
            </Tag>
          )}
          <Tag color={data.isComplete ? 'blue' : 'arcoblue'} size='small'>
            {data.isComplete ? 'Hoàn thành' : `Đang xử lý (${data.progressPercent}%)`}
          </Tag>
        </div>
      </div>

      {/* Progress bar */}
      <div className='mt-12px mb-16px'>
        <Progress
          percent={data.progressPercent}
          status={data.isComplete ? 'success' : 'normal'}
          animation={!data.isComplete}
          size='small'
        />
      </div>

      {/* Visual Stepper */}
      <div className='bg-bg-1/60 rd-12px p-14px border border-border-1'>
        <TomnySteps current={activeStepIdx} size='small' direction='vertical'>
          {data.steps.map((step) => {
            let status: 'wait' | 'process' | 'finish' | 'error' = 'wait';
            let icon: React.ReactNode = <IconClockCircle className='text-t-tertiary' />;

            if (step.completed) {
              status = 'finish';
              icon = <IconCheckCircle className='text-green-500' />;
            } else if (step.inProgress) {
              status = 'process';
              icon = <IconLoading className='text-blue-500 animate-spin' />;
            }

            return (
              <TomnySteps.Step
                key={step.index}
                status={status}
                icon={icon}
                title={
                  <div className='flex items-center gap-8px'>
                    <span
                      className={
                        step.completed
                          ? 'text-t-secondary font-500'
                          : step.inProgress
                            ? 'text-blue-500 font-700'
                            : 'text-t-tertiary'
                      }
                    >
                      {step.title}
                    </span>
                    {step.inProgress && <span className='inline-block size-6px rd-full bg-blue-500 animate-pulse' />}
                  </div>
                }
                description={
                  <div
                    className={`mt-2px text-12px leading-relaxed ${step.completed ? 'text-t-secondary' : step.inProgress ? 'text-t-primary font-500' : 'text-t-tertiary'}`}
                  >
                    {step.description}
                  </div>
                }
              />
            );
          })}
        </TomnySteps>
      </div>

      {/* Output Artifact Section (when finished) */}
      {data.artifactPath && (
        <div className='mt-14px flex flex-col gap-10px rd-12px border border-green-500/30 bg-green-500/5 p-12px'>
          <div className='flex items-center justify-between gap-8px'>
            <div className='flex items-center gap-8px min-w-0'>
              <span className='text-16px'>📦</span>
              <div className='flex flex-col min-w-0'>
                <span className='text-13px font-700 text-t-primary truncate'>
                  {data.packageId
                    ? `Gói: ${data.packageId} ${data.packageVersion ? `(v${data.packageVersion})` : ''}`
                    : 'Gói Tomni (.tomny)'}
                </span>
                <span className='text-11px text-t-tertiary truncate font-mono mt-1px'>{data.artifactPath}</span>
              </div>
            </div>
            <Tag color='green' size='small'>
              Ký số Ed25519
            </Tag>
          </div>

          <div className='flex flex-wrap items-center gap-8px pt-4px'>
            <Button
              type='primary'
              size='small'
              loading={isInstalling}
              icon={<Download theme='outline' size='14' />}
              onClick={handleInstallPackage}
            >
              Cài đặt vào OS
            </Button>
            <Button size='small' icon={<IconFolder />} onClick={handleRevealFile}>
              Mở thư mục
            </Button>
            <Button size='small' type='text' icon={<Copy theme='outline' size='14' />} onClick={handleCopyPath}>
              {copied ? 'Đã sao chép' : 'Sao chép đường dẫn'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StepProgressVisualizer;
