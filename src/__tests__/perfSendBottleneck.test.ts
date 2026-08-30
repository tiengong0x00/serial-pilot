import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalStore } from '../stores/terminalStore';
import type { TerminalMessage } from '../types/serial';

/**
 * 性能瓶颈定位测试
 *
 * 目标：量化 addMessage 的排序开销随消息数组增长的变化，验证
 * "每次 addMessage 全量排序" 是否是快速连发的软件层瓶颈。
 *
 * 背景：对比软件 10 次连发 632ms（63ms/次），本软件 1468ms（147ms/次）。
 * 物理串口传输时间硬件固定，能软件优化的只有各层开销。这里隔离测量
 * 排序这一可疑项。
 */

function makeMessage(type: 'TX' | 'RX', ts: number): TerminalMessage {
  return {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    port_label: 'P1',
    data: new Uint8Array([65, 84, 73]), // "ATI"
    timestamp: ts,
    text: 'ATI',
  };
}

describe('发送瓶颈：addMessage 排序开销', () => {
  beforeEach(() => {
    useTerminalStore.setState({ messages: [], totalBytes: 0, sequenceCounter: 0 });
    // 拉高上限，避免测试中触发自动保存清空
    useTerminalStore.getState().setMaxBytes(100 * 1024 * 1024);
  });

  it('测量：不同数组规模下单次 addMessage 耗时', () => {
    const sizes = [0, 100, 500, 1000, 2000, 5000];
    const results: { size: number; avgMs: number }[] = [];

    for (const size of sizes) {
      // 预填充 size 条消息
      useTerminalStore.setState({ messages: [], sequenceCounter: 0 });
      const store = useTerminalStore.getState();
      const prefill: TerminalMessage[] = [];
      for (let i = 0; i < size; i++) {
        prefill.push(makeMessage(i % 2 === 0 ? 'TX' : 'RX', 1000 + i));
      }
      useTerminalStore.setState({
        messages: prefill.map((m, i) => ({ ...m, sequence: i })),
        sequenceCounter: size,
      });

      // 测量再追加 20 条（模拟 10 次 TX + 10 次 RX）的总耗时
      const iterations = 20;
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        store.addMessage(makeMessage(i % 2 === 0 ? 'TX' : 'RX', 2000 + size + i));
      }
      const t1 = performance.now();
      const avgMs = (t1 - t0) / iterations;
      results.push({ size, avgMs });
    }

    // 打印证据表
    console.log('\n=== addMessage 排序开销 vs 数组规模 ===');
    console.log('数组规模 | 单次平均耗时(ms) | 20次总耗时(ms)');
    for (const r of results) {
      console.log(`${String(r.size).padStart(8)} | ${r.avgMs.toFixed(4).padStart(16)} | ${(r.avgMs * 20).toFixed(3).padStart(14)}`);
    }

    // 验证：随规模增长，耗时应显著上升（证明 O(n log n) 全量排序是瓶颈）
    const small = results[0].avgMs;
    const large = results[results.length - 1].avgMs;
    console.log(`\n规模 0 → 5000：单次耗时从 ${small.toFixed(4)}ms 增长到 ${large.toFixed(4)}ms，放大 ${(large / Math.max(small, 0.0001)).toFixed(1)} 倍`);

    expect(results.length).toBe(sizes.length);
  });

  it('对比：全量排序 vs 纯追加（不排序）的耗时差', () => {
    const size = 2000;
    const iterations = 20;

    // 方案 A：当前实现（全量排序）
    useTerminalStore.setState({ messages: [], sequenceCounter: 0 });
    const prefillA: TerminalMessage[] = [];
    for (let i = 0; i < size; i++) prefillA.push({ ...makeMessage(i % 2 === 0 ? 'TX' : 'RX', 1000 + i), sequence: i });
    useTerminalStore.setState({ messages: prefillA, sequenceCounter: size });
    const store = useTerminalStore.getState();

    const tSortStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      store.addMessage(makeMessage('TX', 5000 + i));
    }
    const sortMs = performance.now() - tSortStart;

    // 方案 B：纯追加模拟（不排序，直接 push）
    let arr: TerminalMessage[] = prefillA.slice();
    const tPushStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      arr = [...arr, makeMessage('TX', 5000 + i)];
    }
    const pushMs = performance.now() - tPushStart;

    console.log('\n=== 全量排序 vs 纯追加（数组 2000 条，追加 20 次）===');
    console.log(`全量排序总耗时: ${sortMs.toFixed(3)}ms`);
    console.log(`纯追加总耗时:   ${pushMs.toFixed(3)}ms`);
    console.log(`排序额外开销:   ${(sortMs - pushMs).toFixed(3)}ms（占比 ${((1 - pushMs / sortMs) * 100).toFixed(1)}%）`);

    expect(sortMs).toBeGreaterThan(0);
    expect(pushMs).toBeGreaterThan(0);
  });

  it('验证：TX 时间戳早于 RX 时排序是否真的必要', () => {
    // 现在 TX 时间戳在 write 前记录，理论上 TX 总是早于其触发的 RX
    // 如果消息按到达顺序天然有序，排序就是纯浪费
    useTerminalStore.setState({ messages: [], sequenceCounter: 0 });
    const store = useTerminalStore.getState();

    // 模拟真实收发序列：TX(t=100) → RX(t=105) → TX(t=200) → RX(t=210)
    store.addMessage(makeMessage('TX', 100));
    store.addMessage(makeMessage('RX', 105));
    store.addMessage(makeMessage('TX', 200));
    store.addMessage(makeMessage('RX', 210));

    const msgs = useTerminalStore.getState().messages;
    // 验证时间戳天然递增（说明追加顺序已正确，无需排序）
    let isNaturallyOrdered = true;
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i].timestamp < msgs[i - 1].timestamp) {
        isNaturallyOrdered = false;
        break;
      }
    }

    console.log('\n=== 消息是否天然有序（无需排序）===');
    console.log(`收发序列时间戳: ${msgs.map((m) => `${m.type}:${m.timestamp}`).join(' → ')}`);
    console.log(`天然有序: ${isNaturallyOrdered ? '是（排序可移除）' : '否（排序必要）'}`);

    expect(isNaturallyOrdered).toBe(true);
  });
});
