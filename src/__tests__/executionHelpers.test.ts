import { describe, it, expect } from 'vitest';
import { textToBytes, appendLineEnding } from '@/lib/testCaseUtils';

describe('串口数据处理辅助函数', () => {
  describe('textToBytes', () => {
    it('应将 UTF-8 文本转换为字节数组', () => {
      const result = textToBytes('AT', 'utf8');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([65, 84]); // 'A' = 0x41, 'T' = 0x54
    });

    it('应处理中文 UTF-8 编码', () => {
      const result = textToBytes('测试', 'utf8');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(2); // 中文字符多字节
    });

    it('应将 HEX 字符串转换为字节数组', () => {
      const result = textToBytes('414243', 'hex');
      expect(Array.from(result)).toEqual([0x41, 0x42, 0x43]); // ABC
    });

    it('HEX 转换应忽略空格', () => {
      const result = textToBytes('41 42 43', 'hex');
      expect(Array.from(result)).toEqual([0x41, 0x42, 0x43]);
    });

    it('HEX 转换应处理小写', () => {
      const result = textToBytes('ff00aa', 'hex');
      expect(Array.from(result)).toEqual([0xff, 0x00, 0xaa]);
    });

    it('HEX 转换应处理混合大小写', () => {
      const result = textToBytes('aAbBcC', 'hex');
      expect(Array.from(result)).toEqual([0xaa, 0xbb, 0xcc]);
    });
  });

  describe('appendLineEnding', () => {
    it('none 应不添加行结束符', () => {
      expect(appendLineEnding('AT', 'none')).toBe('AT');
    });

    it('lf 应添加 LF (\\n)', () => {
      expect(appendLineEnding('AT', 'lf')).toBe('AT\n');
    });

    it('cr 应添加 CR (\\r)', () => {
      expect(appendLineEnding('AT', 'cr')).toBe('AT\r');
    });

    it('crlf 应添加 CRLF (\\r\\n)', () => {
      expect(appendLineEnding('AT', 'crlf')).toBe('AT\r\n');
    });

    it('应处理空字符串', () => {
      expect(appendLineEnding('', 'crlf')).toBe('\r\n');
      expect(appendLineEnding('', 'none')).toBe('');
    });

    it('应处理已包含换行符的文本', () => {
      expect(appendLineEnding('AT\n', 'lf')).toBe('AT\n\n');
    });
  });
});
