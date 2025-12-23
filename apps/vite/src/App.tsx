import React from 'react';
import RoleChat from './components/RoleChat';
import { ConfigProvider, theme } from 'antd';

const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
      }}
    >
      <RoleChat />
    </ConfigProvider>
  );
};

export default App;
