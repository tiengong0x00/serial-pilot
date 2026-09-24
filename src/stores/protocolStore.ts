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

/** Starter template for a new protocol: parsing DSL (see docs/protocol-dsl-spec-v1.0.md). */
export const EXAMPLE_YAML = [
  '# Protocol parsing DSL sample. Storage type decides how many bytes to read;',
  '# modifiers decide how to interpret them.',
  '# Types: u8/u16/../f64 bytes[N] varint(N) bitfield(N) match enum',
  '# Modifiers: bcd/ascii/hex/endian/enum   Attributes: = fixed / if / parse / fallback',
  '# DSL spec: https://github.com/tiengong0x00/serial-pilot/blob/main/docs/protocol-dsl-spec-v1.0.md',
  '',
  'endian be',
  'root Frame',
  '',
  'enum State {',
  '  0: idle',
  '  1: active',
  '}',
  '',
  'struct Frame {',
  '  magic:  u16 = 0xAA55',
  '  flag:   u8 enum State',
  '  length: u16',
  '  body:   bytes[length] ascii',
  '}',
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
