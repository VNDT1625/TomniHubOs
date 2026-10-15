import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = { onSubmit: (question: string) => void };
export const ArticleFollowUpInput: React.FC<Props> = ({ onSubmit }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const submit = (): void => {
    const question = value.trim();
    if (!question) return;
    onSubmit(question);
    setValue('');
  };
  return (
    <div className='realtime-follow-up'>
      <textarea
        aria-label={t('news.hub.askPlaceholder')}
        placeholder={t('news.hub.askPlaceholder')}
        value={value}
        rows={2}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button type='button' className='realtime-primary-button' disabled={!value.trim()} onClick={submit}>
        {t('news.hub.ask')} ↗
      </button>
    </div>
  );
};
