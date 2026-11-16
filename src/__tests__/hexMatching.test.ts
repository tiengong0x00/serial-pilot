/**
 * Hex 格式匹配测试
 *
 * 测试 validateResponse 和 matchPattern 对 hex 格式的支持
 */

import { describe, it, expect } from 'vitest';
import { validateResponse, matchPattern } from '@/lib/testCaseUtils';

describe('Hex format matching', () => {
  describe('matchPattern with hex format', () => {
    it('matches hex pattern (contains mode)', () => {
      // "OK" 的 hex 表示: 4F 4B
      const data = 'Command sent\r\nOK\r\n';
      expect(matchPattern(data, '4F 4B', 'contains', 'hex')).toBe(true);
    });

    it('does not match when hex pattern is absent', () => {
      const data = 'ERROR\r\n';
      // "OK" = 4F 4B
      expect(matchPattern(data, '4F 4B', 'contains', 'hex')).toBe(false);
    });

    it('matches hex pattern (exact mode)', () => {
      const data = 'OK';
      expect(matchPattern(data, '4F 4B', 'exact', 'hex')).toBe(true);
    });

    it('matches hex pattern (startsWith mode)', () => {
      const data = 'OK\r\nData follows';
      expect(matchPattern(data, '4F 4B', 'startsWith', 'hex')).toBe(true);
    });

    it('matches hex pattern (endsWith mode)', () => {
      const data = 'Response: OK';
      expect(matchPattern(data, '4F 4B', 'endsWith', 'hex')).toBe(true);
    });

    it('matches multi-byte hex pattern', () => {
      // "+CSQ: 25" = 2B 43 53 51 3A 20 32 35
      const data = '+CSQ: 25,0\r\nOK';
      expect(matchPattern(data, '2B 43 53 51 3A 20 32 35', 'contains', 'hex')).toBe(true);
    });

    it('handles invalid hex gracefully', () => {
      const data = 'OK';
      // 非法 hex（含有 XY）
      expect(matchPattern(data, '4F XY', 'contains', 'hex')).toBe(false);
    });

    it('handles incomplete hex bytes', () => {
      const data = 'OK';
      // 不完整的字节（奇数长度）
      expect(matchPattern(data, '4F 4', 'contains', 'hex')).toBe(false);
    });

    it('is case-insensitive for hex input', () => {
      const data = 'OK';
      // 小写 hex 也应工作
      expect(matchPattern(data, '4f 4b', 'contains', 'hex')).toBe(true);
      // 混合大小写
      expect(matchPattern(data, '4F 4b', 'contains', 'hex')).toBe(true);
    });
  });

  describe('validateResponse with hex format', () => {
    it('validates hex pattern in custom mode', () => {
      const response = '+CSQ: 25,0\r\nOK';
      // "OK" = 4F 4B
      const result = validateResponse(response, 'custom', '4F 4B', 'contains', 'hex');
      expect(result.valid).toBe(true);
    });

    it('fails validation when hex pattern not found', () => {
      const response = 'ERROR\r\n';
      // "OK" = 4F 4B
      const result = validateResponse(response, 'custom', '4F 4B', 'contains', 'hex');
      expect(result.valid).toBe(false);
    });

    it('validates exact hex match', () => {
      const response = '  OK  ';
      const result = validateResponse(response, 'custom', '4F 4B', 'exact', 'hex');
      expect(result.valid).toBe(true);
    });

    it('standard validation ignores format parameter', () => {
      // 标准验证不受 format 参数影响
      const response = 'OK\r\n';
      const result = validateResponse(response, 'standard', undefined, 'contains', 'hex');
      expect(result.valid).toBe(true);
    });

    it('none validation ignores format parameter', () => {
      const response = 'anything';
      const result = validateResponse(response, 'none', undefined, 'contains', 'hex');
      expect(result.valid).toBe(true);
    });

    it('handles invalid hex in validation', () => {
      const response = 'OK';
      // 非法 hex
      const result = validateResponse(response, 'custom', 'ZZ', 'contains', 'hex');
      expect(result.valid).toBe(false);
    });
  });

  describe('UTF-8 format (default behavior)', () => {
    it('still works with utf8 format explicitly', () => {
      const data = '+CSQ: 25,0\r\nOK';
      expect(matchPattern(data, 'OK', 'contains', 'utf8')).toBe(true);
    });

    it('still works without format parameter (defaults to utf8)', () => {
      const data = '+CSQ: 25,0\r\nOK';
      expect(matchPattern(data, 'OK', 'contains')).toBe(true);
    });
  });

  describe('Special characters in hex', () => {
    it('matches newlines encoded in hex', () => {
      const data = 'Line1\nLine2';
      // \n = 0A
      expect(matchPattern(data, '0A', 'contains', 'hex')).toBe(true);
    });

    it('matches CRLF encoded in hex', () => {
      const data = 'Response\r\nOK';
      // \r\n = 0D 0A
      expect(matchPattern(data, '0D 0A', 'contains', 'hex')).toBe(true);
    });

    it('matches special AT command characters', () => {
      const data = 'AT+CREG?';
      // "+" = 2B, "?" = 3F
      expect(matchPattern(data, '2B 43 52 45 47 3F', 'contains', 'hex')).toBe(true);
    });
  });
});
