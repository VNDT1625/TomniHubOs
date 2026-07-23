import '@arco-design/web-react/dist/css/arco.css';
import '@arco-design/web-react/es/_util/react-19-adapter';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from '@arco-design/web-react';
import { AccountPrototypeApp } from '../ui';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');

createRoot(root).render(
  <React.StrictMode>
    <ConfigProvider>
      <AccountPrototypeApp />
    </ConfigProvider>
  </React.StrictMode>
);
