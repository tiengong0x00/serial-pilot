import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';

/** 输入模式：hex = 十六进制字节，text = ASCII 文本（如 NMEA 语句） */
export type InputMode = 'hex' | 'text';

export interface Protocol {
  id: string;
  name: string;
  yaml: string;
  /** 内置预设：不可编辑 / 删除 */
  builtin?: boolean;
  /** 原生解析器 key（内置预设用），有值时忽略 yaml，走 nativeProtocols 分发 */
  native?: string;
  /** 输入模式，缺省 hex */
  inputMode?: InputMode;
}

interface ProtocolStore {
  protocols: Protocol[];
  activeId: string | null;
  addProtocol: (name: string, yaml?: string) => string;
  updateProtocol: (id: string, updates: Partial<Omit<Protocol, 'id'>>) => void;
  deleteProtocol: (id: string) => void;
  setActive: (id: string | null) => void;
}

/** 新建协议时的示例模板：Kaitai Struct 风格 YAML 子集 */
export const EXAMPLE_YAML = [
  '# Kaitai Struct 风格 YAML 子集，参考 https://doc.kaitai.io/user_guide.html',
  '# 支持: u1/u2/u4/u8 s1.. (可带 le/be) f4/f8 b1..b32 str/strz 自定义子类型',
  '#       size / size-eos / enum / repeat(expr) / if / doc',
  'meta:',
  '  id: example',
  '  endian: be',
  'seq:',
  '  - id: magic',
  '    type: u1',
  '    doc: 帧头',
  '  - id: length',
  '    type: u2',
  '    doc: body 长度',
  '  - id: flag',
  '    type: u1',
  '    enum: state',
  '  - id: body',
  '    size: length',
  '    type: str',
  'enums:',
  '  state:',
  '    0: idle',
  '    1: active',
].join('\n');

/**
 * 协议定义 Store —— 用户自定义协议，持久化到 localStorage。
 * 无内置预设；新建时以 EXAMPLE_YAML 作为初始模板。
 */
export const useProtocolStore = create<ProtocolStore>()(
  persist(
    (set) => ({
      protocols: [],
      activeId: null,

      addProtocol: (name, yaml) => {
        const id = nanoid();
        set((state) => ({
          protocols: [...state.protocols, { id, name, yaml: yaml ?? EXAMPLE_YAML }],
          activeId: id,
        }));
        return id;
      },

      updateProtocol: (id, updates) =>
        set((state) => ({
          protocols: state.protocols.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        })),

      deleteProtocol: (id) =>
        set((state) => {
          const protocols = state.protocols.filter((p) => p.id !== id);
          const activeId = state.activeId === id ? (protocols[0]?.id ?? null) : state.activeId;
          return { protocols, activeId };
        }),

      setActive: (id) => set({ activeId: id }),
    }),
    {
      name: 'toolbox-protocols',
      version: 1,
    }
  )
);
