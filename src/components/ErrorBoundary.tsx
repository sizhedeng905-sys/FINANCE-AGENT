import React from 'react';
import { Button, Result } from 'antd';
import { clearAppStorage } from '@/utils/cache';

interface ErrorBoundaryState {
  error?: Error;
}

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="500"
          title="页面运行出错"
          subTitle={this.state.error.message}
          extra={
            <Button
              type="primary"
              onClick={() => {
                clearAppStorage();
                window.location.href = '/login';
              }}
            >
              清空缓存并重新登录
            </Button>
          }
        />
      );
    }

    return this.props.children;
  }
}
