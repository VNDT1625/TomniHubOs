import { ipcBridge } from '@/common';
import type { IMessageOrchestrationProposal } from '@/common/chat/chatLib';
import { Button, Card, Message, Tag, Typography } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Paragraph, Text, Title } = Typography;

type Decision = 'approved' | 'declined' | null;

type Props = {
  message: IMessageOrchestrationProposal;
};

const MessageOrchestrationProposal: React.FC<Props> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const [decision, setDecision] = useState<Decision>(message.content.decision ?? null);
  const [busy, setBusy] = useState(false);
  const proposal = message.content.proposal;

  useEffect(() => {
    if (message.content.decision) setDecision(message.content.decision);
  }, [message.content.decision]);

  const decide = async (approved: boolean): Promise<void> => {
    if (decision || busy) return;
    setBusy(true);
    try {
      const resolved = await ipcBridge.conversation.resolveNativeOrchestrationProposal.invoke({
        proposal_id: message.content.proposal_id,
        approved,
      });
      if (!resolved) {
        Message.error(t('ide.agentMesh.actionFailed'));
        return;
      }
      setDecision(approved ? 'approved' : 'declined');
    } catch (error) {
      console.error('[MessageOrchestrationProposal] Failed to resolve proposal:', error);
      Message.error(t('ide.agentMesh.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className='mb-4 w-full'
      bordered={false}
      style={{ background: 'var(--bg-1)' }}
      data-testid='message-orchestration-proposal'
    >
      <div className='flex flex-col gap-12px'>
        <div className='flex flex-wrap items-start justify-between gap-10px'>
          <div className='min-w-0 flex-1'>
            <Title heading={6} className='!mb-4px'>
              {proposal.name}
            </Title>
            <Paragraph className='!mb-0 text-t-secondary'>{proposal.reason}</Paragraph>
          </div>
          <div className='flex shrink-0 flex-wrap gap-6px'>
            <Tag color='arcoblue'>{proposal.kind === 'team' ? t('team.sider.title') : t('company.title')}</Tag>
            <Tag>{`${proposal.parallelism}/${proposal.roles.length}`}</Tag>
            {proposal.estimatedTokens ? <Tag>{`≈ ${proposal.estimatedTokens.toLocaleString()}`}</Tag> : null}
          </div>
        </div>

        <div className='overflow-x-auto rd-10px border border-arco-2'>
          <table className='w-full border-collapse text-left text-12px'>
            <thead className='bg-fill-2 text-t-secondary'>
              <tr>
                <th className='px-10px py-8px font-600'>{t('team.create.step.subAgents')}</th>
                <th className='px-10px py-8px font-600'>{t('team.workspace.tasks.fields.description')}</th>
                <th className='px-10px py-8px font-600'>{t('team.workspace.tasks.fields.parentTask')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className='border-t border-arco-2'>
                <td className='px-10px py-9px align-top font-600'>leader</td>
                <td className='px-10px py-9px align-top text-t-secondary'>{proposal.reason}</td>
                <td className='px-10px py-9px align-top text-t-tertiary'>—</td>
              </tr>
              {proposal.roles.map((role) => (
                <tr key={role.id} className='border-t border-arco-2'>
                  <td className='px-10px py-9px align-top'>
                    <div className='font-600 text-t-primary'>{role.name}</div>
                    <div className='mt-2px text-10px text-t-tertiary'>{role.id}</div>
                  </td>
                  <td className='px-10px py-9px align-top text-t-secondary'>{role.responsibility}</td>
                  <td className='px-10px py-9px align-top text-t-tertiary'>
                    {role.dependsOn.length > 0 ? role.dependsOn.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {decision ? (
          <Text type={decision === 'approved' ? 'success' : 'secondary'}>{t('messages.responseSentSuccessfully')}</Text>
        ) : (
          <div className='flex flex-wrap gap-8px'>
            <Button type='primary' loading={busy} onClick={() => void decide(true)}>
              {t('messages.confirm')}
            </Button>
            <Button disabled={busy} onClick={() => void decide(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageOrchestrationProposal;
