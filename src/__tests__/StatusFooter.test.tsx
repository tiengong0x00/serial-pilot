// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatusFooter from '@/components/StatusFooter';
import { useTerminalStore } from '@/stores/terminalStore';
import { useSerialStore } from '@/stores/serialStore';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'app.disconnected': '未连接',
        'statusFooter.messages': '条消息',
        'statusFooter.clickToViewLogs': '点击查看完整日志',
        'statusFooter.systemLogs': '系统日志',
        'statusFooter.noSystemLogs': '暂无系统日志',
      };
      return translations[key] || key;
    },
  }),
}));

describe('StatusFooter 组件测试', () => {
  beforeEach(() => {
    // 重置 stores
    useTerminalStore.getState().clearMessages();
    useTerminalStore.getState().clearSystemLogs();
    useSerialStore.setState({
      connectionStatus: { p1_connected: false, p2_connected: false },
      p1PortName: null,
      p2PortName: null,
    });
  });

  it('应显示未连接状态', () => {
    render(<StatusFooter />);
    // 新的快速配置布局：P1: 和端口名在不同元素
    expect(screen.getByText('P1:')).toBeInTheDocument();
    expect(screen.getAllByText('未连接')[0]).toBeInTheDocument();
    expect(screen.getByText('P2:')).toBeInTheDocument();
    expect(screen.getAllByText('未连接')[1]).toBeInTheDocument();
  });

  it('应显示 P1 连接状态和端口名', () => {
    useSerialStore.setState({
      connectionStatus: { p1_connected: true, p2_connected: false },
      p1PortName: 'COM3',
      p1Config: { baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 1, flow_control: 'none', dtr: true, rts: false },
    });
    render(<StatusFooter />);
    expect(screen.getByText('P1:')).toBeInTheDocument();
    expect(screen.getByText('COM3')).toBeInTheDocument();
    expect(screen.getByText('115200')).toBeInTheDocument(); // 波特率显示
  });

  it('应显示系统日志计数', () => {
    useTerminalStore.getState().addMessage({
      id: 'sys1',
      type: 'SYS',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: '系统日志',
    });
    render(<StatusFooter />);
    expect(screen.getByText(/1 条消息/)).toBeInTheDocument();
  });

  it('应显示最后一条系统消息', () => {
    useTerminalStore.getState().addMessage({
      id: 'sys1',
      type: 'SYS',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: '连接成功',
    });
    render(<StatusFooter />);
    expect(screen.getByText('连接成功')).toBeInTheDocument();
  });

  it('点击系统消息应打开日志对话框', async () => {
    const user = userEvent.setup();
    useTerminalStore.getState().addMessage({
      id: 'sys1',
      type: 'SYS',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: '测试消息',
    });
    render(<StatusFooter />);

    const messageButton = screen.getByText('测试消息');
    await user.click(messageButton);

    // 对话框标题应出现（使用 getByRole 更精确）
    expect(screen.getByRole('heading', { name: '系统日志' })).toBeInTheDocument();
  });

  it('日志对话框应只显示 SYS 类型消息', async () => {
    const user = userEvent.setup();
    const addMessage = useTerminalStore.getState().addMessage;

    addMessage({
      id: 'rx1',
      type: 'RX',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: 'RX消息',
    });
    addMessage({
      id: 'sys1',
      type: 'SYS',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: '系统消息1',
    });
    addMessage({
      id: 'sys2',
      type: 'SYS',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: '系统消息2',
    });

    render(<StatusFooter />);

    // 点击打开对话框（状态栏显示最后一条 SYS，使用 getAllByText 取第一个）
    await user.click(screen.getAllByText('系统消息2')[0]);

    // 对话框应该打开
    expect(screen.getByRole('heading', { name: '系统日志' })).toBeInTheDocument();

    // 弹窗合并显示系统日志与执行摘要（无视图切换）
    // 应只显示 SYS 消息（在对话框内，getAllByText 会找到多个）
    const sys1Matches = screen.getAllByText(/系统消息1/);
    const sys2Matches = screen.getAllByText(/系统消息2/);
    expect(sys1Matches.length).toBeGreaterThan(0);
    expect(sys2Matches.length).toBeGreaterThan(0);
    expect(screen.queryByText('RX消息')).not.toBeInTheDocument();
  });
});
