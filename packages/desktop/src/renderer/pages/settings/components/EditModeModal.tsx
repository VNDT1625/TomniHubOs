import type { IProvider } from '@/common/config/storage';
import ModalHOC from '@/renderer/utils/ui/ModalHOC';
import { Form, Input, Select, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TomnyModal from '@/renderer/components/base/TomnyModal';
import { LinkCloud } from '@icon-park/react';
import useModeModeList from '@renderer/hooks/agent/useModeModeList';
import { getProviderLogo } from '@/renderer/utils/model/modelPlatforms';

const PLATFORM_BADGE_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  gemini: { bg: '#4285F4', color: '#ffffff', label: 'G' },
  'gemini-vertex-ai': { bg: '#4285F4', color: '#ffffff', label: 'G' },
  openai: { bg: '#10A37F', color: '#ffffff', label: 'O' },
  anthropic: { bg: '#D97757', color: '#ffffff', label: 'A' },
  'new-api': { bg: '#0284C7', color: '#ffffff', label: 'N' },
  bedrock: { bg: '#FF9900', color: '#ffffff', label: 'B' },
  'aws-bedrock': { bg: '#FF9900', color: '#ffffff', label: 'B' },
  deepseek: { bg: '#4D6BFE', color: '#ffffff', label: 'D' },
};

/**
 * 供应商 Logo 组件
 * Provider Logo Component with fallback to branded badge when image is unavailable
 */
const ProviderLogo: React.FC<{ logo: string | null; name: string; size?: number; platform?: string }> = ({
  logo,
  name,
  size = 20,
  platform,
}) => {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [logo]);

  if (logo && !loadFailed) {
    return (
      <img
        src={logo}
        alt={name}
        className='object-contain shrink-0'
        style={{ width: size, height: size }}
        onError={() => setLoadFailed(true)}
      />
    );
  }

  const key = (platform || name || '').toLowerCase();
  const badge = PLATFORM_BADGE_COLORS[key] || Object.entries(PLATFORM_BADGE_COLORS).find(([k]) => key.includes(k))?.[1];

  if (badge) {
    return (
      <div
        className='flex items-center justify-center font-bold shrink-0 rounded-4px shadow-xs'
        style={{
          width: size,
          height: size,
          backgroundColor: badge.bg,
          color: badge.color,
          fontSize: Math.max(9, Math.round(size * 0.55)),
          lineHeight: 1,
        }}
      >
        {badge.label}
      </div>
    );
  }

  return <LinkCloud theme='outline' size={size} className='text-t-secondary flex shrink-0' />;
};

const EditModeModal = ModalHOC<{ data?: IProvider; onChange(data: IProvider): void }>(
  ({ modalProps, modalCtrl, ...props }) => {
    const { t } = useTranslation();
    const { data } = props;
    const [form] = Form.useForm();

    // Watch bedrockAuthMethod only for UI conditional rendering (not for auto-refresh)
    const bedrockAuthMethod = Form.useWatch('bedrockAuthMethod', form);
    const isBedrock = data?.platform === 'bedrock';

    // 获取供应商 Logo / Get provider logo
    const providerLogo = useMemo(() => {
      return getProviderLogo({ name: data?.name, base_url: data?.base_url, platform: data?.platform });
    }, [data?.name, data?.base_url, data?.platform]);

    const isFullUrl = data?.is_full_url ?? false;

    const modelListState = useModeModeList(data?.id);
    const modelOptions = useMemo(
      () => (isFullUrl ? [] : (modelListState.data?.models.map((option) => Object.assign({}, option)) ?? [])),
      [isFullUrl, modelListState.data?.models]
    );

    useEffect(() => {
      if (data) {
        form.setFieldsValue({
          ...data,
          model:
            data.models && data.models.length > 0
              ? data.models.length === 1
                ? data.models[0]
                : data.models
              : undefined,
          bedrockAuthMethod: data.bedrock_config?.auth_method || 'accessKey',
          bedrockRegion: data.bedrock_config?.region || 'us-east-1',
          bedrockAccessKeyId: data.bedrock_config?.access_key_id || '',
          bedrockSecretAccessKey: data.bedrock_config?.secret_access_key || '',
          bedrockProfile: data.bedrock_config?.profile || '',
        });
      }
    }, [data, form]);

    return (
      <TomnyModal
        visible={modalProps.visible}
        onCancel={modalCtrl.close}
        header={{ title: t('settings.editModel'), showClose: true }}
        style={{ minHeight: '400px', maxHeight: '90vh', borderRadius: 16 }}
        contentStyle={{
          background: 'var(--dialog-fill-0)',
          borderRadius: 16,
          padding: '20px 24px 16px',
          overflow: 'auto',
        }}
        onOk={async () => {
          try {
            const values = await form.validate();
            const updatedProvider: IProvider = {
              ...data,
              ...values,
              // Ensure models is always an array
              models: Array.isArray(values.model) ? values.model : [values.model],
            };

            // Add Bedrock configuration if platform is Bedrock
            if (isBedrock) {
              updatedProvider.bedrock_config = {
                auth_method: values.bedrockAuthMethod,
                region: values.bedrockRegion,
                ...(values.bedrockAuthMethod === 'accessKey'
                  ? {
                      access_key_id: values.bedrockAccessKeyId,
                      secret_access_key: values.bedrockSecretAccessKey,
                    }
                  : {
                      profile: values.bedrockProfile,
                    }),
              };
            }

            props.onChange(updatedProvider);
            modalCtrl.close();
          } catch {
            // Validation failed — Arco Form highlights invalid fields automatically
          }
        }}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <div className='py-20px'>
          <Form form={form} layout='vertical'>
            {/* 模型供应商名称（可编辑，带 Logo）/ Model Provider name (editable, with Logo) */}
            <Form.Item
              label={
                <div className='flex items-center gap-6px'>
                  <ProviderLogo logo={providerLogo} name={data?.name || ''} platform={data?.platform} size={16} />
                  <span>{t('settings.modelProvider')}</span>
                </div>
              }
              field='name'
              required
              rules={[{ required: true }]}
            >
              <Input placeholder={t('settings.modelProvider')} />
            </Form.Item>

            {/* Base URL */}
            <Form.Item
              hidden={isBedrock}
              label={
                <span className='inline-flex items-center gap-4px'>
                  {t('settings.apiEndpoint', 'API 请求地址')}
                  {isFullUrl && (
                    <Tag size='small' color='arcoblue'>
                      {t('settings.fullUrl', '完整URL')}
                    </Tag>
                  )}
                </span>
              }
              required={data?.platform !== 'gemini' && data?.platform !== 'gemini-vertex-ai' && !isBedrock}
              rules={[{ required: data?.platform !== 'gemini' && data?.platform !== 'gemini-vertex-ai' && !isBedrock }]}
              field={'base_url'}
              disabled
            >
              <Input></Input>
            </Form.Item>

            <Form.Item
              hidden={isBedrock}
              label={t('settings.apiKey')}
              required={!isBedrock}
              rules={[{ required: !isBedrock }]}
              field={'api_key'}
              extra={<div className='text-11px text-t-secondary mt-2'>💡 {t('settings.multiApiKeyEditTip')}</div>}
            >
              <Input.TextArea rows={4} placeholder={t('settings.apiKeyPlaceholder')} />
            </Form.Item>

            {/* AWS Bedrock Authentication Method */}
            <Form.Item
              hidden={!isBedrock}
              label={t('settings.bedrock.authMethod')}
              field={'bedrockAuthMethod'}
              required={isBedrock}
              rules={[{ required: isBedrock }]}
            >
              <Select>
                <Select.Option value='accessKey'>{t('settings.bedrock.authMethodAccessKey')}</Select.Option>
                <Select.Option value='profile'>{t('settings.bedrock.authMethodProfile')}</Select.Option>
              </Select>
            </Form.Item>

            {/* AWS Region */}
            <Form.Item
              hidden={!isBedrock}
              label={t('settings.bedrock.region')}
              field={'bedrockRegion'}
              required={isBedrock}
              rules={[{ required: isBedrock }]}
              extra={t('settings.bedrock.regionHint')}
            >
              <Select showSearch>
                <Select.Option value='us-east-1'>US East (N. Virginia)</Select.Option>
                <Select.Option value='us-west-2'>US West (Oregon)</Select.Option>
                <Select.Option value='eu-west-1'>Europe (Ireland)</Select.Option>
                <Select.Option value='eu-central-1'>Europe (Frankfurt)</Select.Option>
                <Select.Option value='ap-southeast-1'>Asia Pacific (Singapore)</Select.Option>
                <Select.Option value='ap-northeast-1'>Asia Pacific (Tokyo)</Select.Option>
                <Select.Option value='ap-southeast-2'>Asia Pacific (Sydney)</Select.Option>
                <Select.Option value='ca-central-1'>Canada (Central)</Select.Option>
              </Select>
            </Form.Item>

            {/* Access Key ID */}
            <Form.Item
              hidden={!isBedrock || bedrockAuthMethod !== 'accessKey'}
              label={t('settings.bedrock.accessKeyId')}
              field={'bedrockAccessKeyId'}
              required={isBedrock && bedrockAuthMethod === 'accessKey'}
              rules={[{ required: isBedrock && bedrockAuthMethod === 'accessKey' }]}
            >
              <Input.Password placeholder='AKIA...' visibilityToggle />
            </Form.Item>

            {/* Secret Access Key */}
            <Form.Item
              hidden={!isBedrock || bedrockAuthMethod !== 'accessKey'}
              label={t('settings.bedrock.secretAccessKey')}
              field={'bedrockSecretAccessKey'}
              required={isBedrock && bedrockAuthMethod === 'accessKey'}
              rules={[{ required: isBedrock && bedrockAuthMethod === 'accessKey' }]}
            >
              <Input.Password visibilityToggle />
            </Form.Item>

            {/* AWS Profile */}
            <Form.Item
              hidden={!isBedrock || bedrockAuthMethod !== 'profile'}
              label={t('settings.bedrock.profile')}
              field={'bedrockProfile'}
              required={isBedrock && bedrockAuthMethod === 'profile'}
              rules={[{ required: isBedrock && bedrockAuthMethod === 'profile' }]}
              extra={t('settings.bedrock.profileHint')}
            >
              <Input placeholder='default' />
            </Form.Item>

            {/* Model Selection */}
            <Form.Item
              label={t('settings.modelName')}
              field={'model'}
              required
              rules={[{ required: true }]}
              validateStatus={!isFullUrl && modelListState.error ? 'error' : undefined}
              help={!isFullUrl && modelListState.error ? t('common.failed') : undefined}
            >
              <Select
                loading={!isFullUrl && modelListState.isLoading}
                showSearch
                allowCreate
                mode={data?.models && data.models.length > 1 ? 'multiple' : undefined}
                onFocus={() => {
                  if (isFullUrl) return;
                  void modelListState.mutate();
                }}
                options={modelOptions}
              />
            </Form.Item>
          </Form>
        </div>
      </TomnyModal>
    );
  }
);

export default EditModeModal;
