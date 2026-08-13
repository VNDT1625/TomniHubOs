import type { ModalProps } from '@arco-design/web-react';
import { Button, Modal } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import React from 'react';

interface ModalWrapperProps extends Omit<ModalProps, 'title'> {
  children?: React.ReactNode;
  title?: React.ReactNode;
  showCustomClose?: boolean;
}

const ModalWrapper: React.FC<ModalWrapperProps> = ({
  children,
  title,
  showCustomClose = true,
  onCancel,
  className = '',
  ...props
}) => {
  return (
    <Modal {...props} title={null} closable={false} onCancel={onCancel} className={`tomny-modal ${className}`}>
      <div>
        {showCustomClose && title && (
          <div className='tomny-modal-header'>
            <h3 className='tomny-modal-title'>{title}</h3>
            <Button type='text' size='small' onClick={onCancel} className='tomny-modal-close-btn'>
              <Close size={20} fill='currentColor' />
            </Button>
          </div>
        )}
        {children}
      </div>
    </Modal>
  );
};

export default ModalWrapper;
