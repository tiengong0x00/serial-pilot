import React, { useState, useEffect } from 'react';

interface NotificationAction {
  label: string;
  onClick: () => void;
}

interface NotificationProps {
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  actions?: NotificationAction[];
  onClose: () => void;
}

export const TestNotification: React.FC<NotificationProps> = ({
  type,
  title,
  message,
  actions,
  onClose,
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 入场动画
    setTimeout(() => setVisible(true), 10);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  const getBorderColor = () => {
    switch (type) {
      case 'success':
        return 'border-green-500 dark:border-green-400';
      case 'error':
        return 'border-red-500 dark:border-red-400';
      case 'info':
        return 'border-blue-500 dark:border-blue-400';
      default:
        return 'border-gray-500';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return (
          <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'info':
        return (
          <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div
      className={`fixed bg-white dark:bg-gray-800 rounded-lg shadow-2xl border-2 transition-all duration-300 z-50 ${
        visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      } ${getBorderColor()}`}
      style={{
        top: 'calc(3.5rem + 3rem)', // Header(h-14=3.5rem) + 工具栏高度(约3rem)
        right: '0',
      }}
    >
      <div className="p-3">
        {/* 第一行：图标 + 文字 + 关闭 */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0">
            {getIcon()}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
            {message && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-line">
                {message}
              </p>
            )}
          </div>

          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 第二行：按钮 */}
        {actions && actions.length > 0 && (
          <div className="flex gap-2">
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={() => {
                  action.onClick();
                  handleClose();
                }}
                className="flex-1 px-4 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// 通知管理器
class NotificationManager {
  private listeners: Array<(props: NotificationProps) => void> = [];

  subscribe(callback: (props: NotificationProps) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  show(props: Omit<NotificationProps, 'onClose'>) {
    this.listeners.forEach(listener => {
      listener({
        ...props,
        onClose: () => {},
      });
    });
  }
}

export const notificationManager = new NotificationManager();

export function showNotification(props: Omit<NotificationProps, 'onClose'>) {
  notificationManager.show(props);
}

// 通知容器组件
export function NotificationContainer() {
  const [notifications, setNotifications] = useState<NotificationProps[]>([]);

  useEffect(() => {
    return notificationManager.subscribe((props) => {
      const notification = {
        ...props,
        onClose: () => {
          setNotifications(prev => prev.filter(n => n !== notification));
        },
      };
      setNotifications(prev => [...prev, notification]);

      // 10秒后自动关闭
      setTimeout(() => {
        notification.onClose();
      }, 10000);
    });
  }, []);

  return (
    <>
      {notifications.map((notification, index) => (
        <TestNotification
          key={index}
          {...notification}
        />
      ))}
    </>
  );
}
