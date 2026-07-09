import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/global.css';
import { clearLegacyAppStorageOnce } from './utils/cache';

dayjs.locale('zh-cn');
clearLegacyAppStorageOnce();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, sans-serif',
        },
        components: {
          Card: {
            borderRadiusLG: 8,
          },
          Button: {
            borderRadius: 8,
          },
        },
      }}
    >
      <AntApp>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
