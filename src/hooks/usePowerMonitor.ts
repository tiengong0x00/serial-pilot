/**
 * Windows 电源事件监听 Hook
 *
 * 监听系统休眠/恢复事件，在休眠前后执行相应操作：
 * - 休眠前：提示用户串口已断开
 * - 恢复后：自动刷新端口列表并提示用户重新连接
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSerialCommands } from './useSerialCommands';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export function usePowerMonitor() {
  const { t } = useTranslation();
  const { getSerialPorts } = useSerialCommands();

  useEffect(() => {
    let unlistenSuspend: (() => void) | undefined;
    let unlistenResume: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        // 监听休眠事件
        unlistenSuspend = await listen('power_suspend', () => {
          console.warn('[Power] System suspending, all serial ports disconnected');
          toast.warning(t('power.suspendWarning'), {
            duration: 5000,
          });
        });

        // 监听恢复事件
        unlistenResume = await listen('power_resume', async () => {
          console.info('[Power] System resumed from suspend');

          // 延迟刷新（等待驱动完全恢复）
          setTimeout(async () => {
            try {
              await getSerialPorts();

              toast.info(t('power.resumeInfo'), {
                duration: 5000,
                action: {
                  label: t('common.refresh'),
                  onClick: () => void getSerialPorts(),
                },
              });
            } catch (error) {
              console.error('[Power] Failed to refresh ports after resume:', error);
            }
          }, 2000);
        });

        console.info('[Power] Power monitor initialized');
      } catch (error) {
        console.error('[Power] Failed to setup power monitor:', error);
      }
    };

    setupListeners();

    return () => {
      unlistenSuspend?.();
      unlistenResume?.();
    };
  }, [getSerialPorts, t]);
}
