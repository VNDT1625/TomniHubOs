/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal, Tabs, Button, Tag } from '@arco-design/web-react';
import { ChartHistogram, Code, Compass, DashboardOne, Edit, Lightning, List, Right, Shield } from '@icon-park/react';
import '@/renderer/styles/glassmorphism.css';

const { TabPane } = Tabs;

interface PromptLibraryModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectPrompt: (promptText: string) => void;
}

interface PromptCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  prompts: {
    title: string;
    description: string;
    prompt: string;
    tag?: string;
  }[];
}

const PROMPT_CATEGORIES: PromptCategory[] = [
  {
    id: 'planning',
    name: 'Kế Hoạch & Kiến Trúc',
    icon: <Compass theme='outline' size={14} />,
    prompts: [
      {
        title: 'Kế hoạch phát triển MVP toàn diện',
        description: 'Phân tích yêu cầu, phân chia giai đoạn (C0-C6) và thiết lập tiêu chí nghiệm thu rõ ràng.',
        prompt:
          'Hãy lập kế hoạch phát triển MVP toàn diện cho dự án với các mốc milestone rõ ràng, phân chia nhiệm vụ theo cấu trúc checklist chi tiết.',
        tag: 'Khuyên dùng',
      },
      {
        title: 'Khảo sát & Đánh giá Kiến trúc Hệ thống',
        description: 'Rà soát mã nguồn, phát hiện các điểm nghẽn (bottlenecks) và đề xuất giải pháp refactor.',
        prompt:
          'Hãy phân tích kiến trúc mã nguồn hiện tại, chỉ ra các điểm nghẽn hiệu năng, rủi ro bảo mật và đề xuất giải pháp tái cấu trúc tối ưu.',
      },
      {
        title: 'Thiết kế Mô hình Dữ liệu PostgreSQL',
        description: 'Tối ưu schema bảng, index và chính sách bảo mật Row-Level Security (RLS).',
        prompt:
          'Hãy thiết kế cấu trúc schema cơ sở dữ liệu PostgreSQL cho tính năng này kèm theo chỉ mục index và chính sách Row-Level Security (RLS) bảo mật cao.',
      },
    ],
  },
  {
    id: 'coding',
    name: 'Lập Trình & Tối Ưu',
    icon: <Code theme='outline' size={14} />,
    prompts: [
      {
        title: 'Tái cấu trúc mã nguồn theo Clean Architecture',
        description: 'Tách rời business logic, adapter và UI layer để tăng khả năng mở rộng.',
        prompt:
          'Hãy tái cấu trúc (refactor) đoạn mã này theo chuẩn Clean Architecture, tách biệt rõ ràng giữa Business Logic, Data Access và UI Component.',
        tag: 'Phổ biến',
      },
      {
        title: 'Viết Bộ Kiểm Thử Tự Động Toàn Diện',
        description: 'Unit test, Integration test và mock dịch vụ với độ bao phủ > 90%.',
        prompt:
          'Hãy viết bộ kiểm thử tự động (Unit Test và Integration Test) cho module này bằng Vitest/Jest, bao phủ các trường hợp biên (edge cases).',
      },
      {
        title: 'Tối ưu Hiệu Năng Render React',
        description: 'Khắc phục tình trạng re-render không cần thiết và tối ưu bộ nhớ.',
        prompt:
          'Hãy kiểm tra và tối ưu hóa hiệu năng render của component này, loại bỏ các re-render thừa bằng useMemo, useCallback và cấu trúc state hợp lý.',
      },
    ],
  },
  {
    id: 'automation',
    name: 'Tự Động Hóa & Quản Trị',
    icon: <DashboardOne theme='outline' size={14} />,
    prompts: [
      {
        title: 'Tạo Kịch Bản Cron Job Định Kỳ',
        description: 'Lập lịch tự động chạy nền không gián đoạn.',
        prompt:
          'Hãy tạo một kịch bản Cron Job tự động chạy định kỳ mỗi ngày để tổng hợp số liệu, tạo báo cáo tóm tắt và đồng bộ vào hệ thống.',
      },
      {
        title: 'Trích Xuất Đầu Việc Thành Task',
        description: 'Chuyển đổi ghi chú văn bản thành danh sách công việc trong Personal Manager.',
        prompt:
          'Hãy đọc đoạn nội dung này và trích xuất thành danh sách các công việc cụ thể (Tasks) kèm mức độ ưu tiên để đưa vào Trung tâm Quản lý.',
      },
      {
        title: 'Phân Loại Tin Nhắn Theo Ma Trận Laya P0-P3',
        description: 'Ứng dụng Laya Engine để lọc tạp âm và phân loại tin tức quan trọng.',
        prompt:
          'Hãy phân tích danh sách thông báo và phân loại theo ma trận 4 cấp độ Laya: P0 (Khẩn cấp), P1 (Trong ngày), P2 (Gom digest), P3 (Lọc bỏ).',
      },
    ],
  },
  {
    id: 'security',
    name: 'Bảo Mật & Riêng Tư',
    icon: <Shield theme='outline' size={14} />,
    prompts: [
      {
        title: 'Kiểm toán Bảo mật & OWASP Top 10',
        description: 'Kiểm tra lỗ hổng injection, SSRF, XSS và phân quyền.',
        prompt:
          'Hãy kiểm toán bảo mật toàn bộ mã nguồn của endpoint này theo tiêu chuẩn OWASP Top 10 và chỉ ra các rủi ro tiềm ẩn.',
      },
      {
        title: 'Đảm Bảo Ranh Giới Dữ Liệu Cục Bộ (Zero-Egress)',
        description: 'Xác minh không có dữ liệu nhạy cảm nào bị gửi ra internet.',
        prompt:
          'Hãy kiểm tra luồng truyền dữ liệu để đảm bảo nguyên tắc Zero Data Egress: dữ liệu riêng tư và khóa bí mật phải được giữ hoàn toàn ở local.',
      },
    ],
  },
];

export const PromptLibraryModal: React.FC<PromptLibraryModalProps> = ({ visible, onClose, onSelectPrompt }) => {
  const [activeTab, setActiveTab] = useState('planning');

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Lightning theme='outline' size={18} fill='#38bdf8' />
          <span style={{ fontWeight: 700, fontSize: '15px' }}>Thư Viện Câu Lệnh Gợi Ý (Prompt Templates)</span>
        </div>
      }
      visible={visible}
      onCancel={onClose}
      footer={null}
      // modal width handled in style
      unmountOnExit
      className='tomni-glass-panel'
      style={{
        width: '680px',
        maxWidth: '90vw',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(28px) saturate(190%)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
      }}
    >
      <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
        Chọn một mẫu câu lệnh chuyên sâu để bắt đầu phiên làm việc cùng Tomni AI Agent:
      </div>

      <Tabs activeTab={activeTab} onChange={setActiveTab} type='rounded' size='small'>
        {PROMPT_CATEGORIES.map((cat) => (
          <TabPane
            key={cat.id}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {cat.icon}
                <span>{cat.name}</span>
              </div>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
              {cat.prompts.map((p, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  onClick={() => {
                    onSelectPrompt(p.prompt);
                    onClose();
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontSize: '13px', color: '#f8fafc' }}>{p.title}</strong>
                      {p.tag && (
                        <Tag
                          color='arcoblue'
                          size='small'
                          style={{ fontSize: '10px', height: '18px', lineHeight: '16px' }}
                        >
                          {p.tag}
                        </Tag>
                      )}
                    </div>
                    <Right theme='outline' size={14} fill='#38bdf8' />
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.45 }}>{p.description}</div>
                  <div
                    style={{
                      marginTop: '6px',
                      fontSize: '11px',
                      color: '#64748b',
                      fontStyle: 'italic',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    &ldquo;{p.prompt}&rdquo;
                  </div>
                </div>
              ))}
            </div>
          </TabPane>
        ))}
      </Tabs>
    </Modal>
  );
};

export default PromptLibraryModal;
