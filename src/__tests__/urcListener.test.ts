import { describe, it, expect } from 'vitest';
import { matchPattern, extractVariables } from '@/lib/testCaseUtils';

describe('URC 监听器', () => {
  describe('matchPattern', () => {
    describe('contains 模式', () => {
      it('应匹配包含子串的数据', () => {
        expect(matchPattern('+CREG: 1,1\r\n', 'CREG', 'contains')).toBe(true);
      });

      it('不包含子串应不匹配', () => {
        expect(matchPattern('+CSQ: 25,0', 'CREG', 'contains')).toBe(false);
      });
    });

    describe('exact 模式', () => {
      it('应精确匹配（忽略首尾空白）', () => {
        expect(matchPattern('  RING  ', 'RING', 'exact')).toBe(true);
        expect(matchPattern('RING\r\n', 'RING', 'exact')).toBe(true);
      });

      it('不完全相同应不匹配', () => {
        expect(matchPattern('RINGING', 'RING', 'exact')).toBe(false);
      });
    });

    describe('startsWith 模式', () => {
      it('应匹配以指定字符串开头的数据', () => {
        expect(matchPattern('  +CREG: 1', '+CREG', 'startsWith')).toBe(true);
      });

      it('不以指定字符串开头应不匹配', () => {
        expect(matchPattern('OK\r\n+CREG', '+CREG', 'startsWith')).toBe(false);
      });
    });

    describe('endsWith 模式', () => {
      it('应匹配以指定字符串结尾的数据', () => {
        expect(matchPattern('status: OK  ', 'OK', 'endsWith')).toBe(true);
      });

      it('不以指定字符串结尾应不匹配', () => {
        expect(matchPattern('OK then ERROR', 'OK', 'endsWith')).toBe(false);
      });
    });

    describe('regex 模式', () => {
      it('应支持正则匹配', () => {
        expect(matchPattern('+CSQ: 25,0', '\\+CSQ: \\d+,\\d+', 'regex')).toBe(true);
      });

      it('正则不匹配应返回 false', () => {
        expect(matchPattern('ERROR', '\\+CSQ: \\d+,\\d+', 'regex')).toBe(false);
      });

      it('非法正则应返回 false', () => {
        expect(matchPattern('text', '[invalid(', 'regex')).toBe(false);
      });
    });

    describe('流式累积缓冲区场景', () => {
      it('部分数据到达时不匹配，完整数据到达后匹配', () => {
        // 模拟串口数据分片到达
        let buffer = '';
        buffer += '+CR';
        expect(matchPattern(buffer, '+CREG:', 'contains')).toBe(false);

        buffer += 'EG: 1';
        expect(matchPattern(buffer, '+CREG:', 'contains')).toBe(true);
      });
    });
  });

  describe('URC 数据提取（复用 extractVariables）', () => {
    it('应从 URC 内容提取变量供后续命令使用', () => {
      // 模拟 +CSQ URC 上报，提取信号强度
      const urcData = '+CSQ: 25,0\r\n';
      const extracted = extractVariables(urcData, {
        enabled: true,
        parseType: 'regex',
        parsePattern: '\\+CSQ: (\\d+),(\\d+)',
        parameterMap: {
          signal: '1',
          error_rate: '2',
        },
      });
      expect(extracted).toEqual({ signal: '25', error_rate: '0' });
    });

    it('应从 URC 网络注册状态提取变量', () => {
      const urcData = '+CREG: 0,1';
      const extracted = extractVariables(urcData, {
        enabled: true,
        parseType: 'split',
        parsePattern: ',',
        parameterMap: {
          mode: '0',
          status: '1',
        },
      });
      // '+CREG: 0' 和 ' 1'，split 后 trim
      expect(extracted.status).toBe('1');
    });
  });
});
