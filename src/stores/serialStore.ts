import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PortInfo, ConnectionStatus, SerialConfig } from '../types/serial';

interface SerialStore {
  // 状态
  ports: PortInfo[];
  connectionStatus: ConnectionStatus;
  p1PortName: string | null; // P1 当前连接的端口名
  p2PortName: string | null; // P2 当前连接的端口名

  // 持久化配置
  p1Config: SerialConfig;
  p2Config: SerialConfig;

  // Actions
  setPorts: (ports: PortInfo[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setPortName: (label: 'P1' | 'P2', name: string | null) => void;
  setConfig: (label: 'P1' | 'P2', config: SerialConfig) => void;
  reset: () => void;
}

const defaultConfig: SerialConfig = {
  baud_rate: 115200,
  data_bits: 8,
  parity: 'none',
  stop_bits: 1,
  flow_control: 'none',
  dtr: true,   // 参照 SSCOM：DTR 默认勾选
  rts: false,  // 参照 SSCOM：RTS 默认不勾选
};

const initialState = {
  ports: [],
  connectionStatus: {
    p1_connected: false,
    p2_connected: false,
  },
  p1PortName: null,
  p2PortName: null,
  p1Config: defaultConfig,
  p2Config: defaultConfig,
};

export const useSerialStore = create<SerialStore>()(
  persist(
    (set) => ({
      ...initialState,

      setPorts: (ports) => set({ ports }),

      setConnectionStatus: (status) => set({ connectionStatus: status }),

      setPortName: (label, name) =>
        set(label === 'P1' ? { p1PortName: name } : { p2PortName: name }),

      setConfig: (label, config) =>
        set(label === 'P1' ? { p1Config: config } : { p2Config: config }),

      reset: () => set(initialState),
    }),
    {
      name: 'serial-pilot-connection', // localStorage key
      version: 1,
      // 只持久化配置，不持久化运行时状态（ports/connectionStatus/portName）
      partialize: (state) => ({
        p1Config: state.p1Config,
        p2Config: state.p2Config,
      }),
      // 迁移：老配置缺少 flow_control/dtr/rts 字段时补默认值
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SerialStore>;
        const fill = (cfg?: SerialConfig): SerialConfig => ({
          ...defaultConfig,
          ...(cfg ?? {}),
        });
        return {
          ...current,
          p1Config: fill(p.p1Config),
          p2Config: fill(p.p2Config),
        };
      },
    }
  )
);
