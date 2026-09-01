import { describe, it, expect } from 'vitest';
import {
  tokenize,
  findPlaceholder,
  longestCommonPrefix,
  getRemainingHint,
  parseBaseCmd,
  classifyTemplate,
  stripOptionalBrackets,
} from '@/lib/commandTemplate';

describe('tokenize', () => {
  it('拆分死文本与占位符', () => {
    expect(tokenize('AT+CEREG=<n>')).toEqual([
      { type: 'literal', text: 'AT+CEREG=' },
      { type: 'placeholder', text: '<n>' },
    ]);
  });

  it('多占位符与中间死文本', () => {
    expect(tokenize('+CEREG: <stat>,<tac>')).toEqual([
      { type: 'literal', text: '+CEREG: ' },
      { type: 'placeholder', text: '<stat>' },
      { type: 'literal', text: ',' },
      { type: 'placeholder', text: '<tac>' },
    ]);
  });

  it('纯死文本', () => {
    expect(tokenize('AT')).toEqual([{ type: 'literal', text: 'AT' }]);
  });

  it('未闭合尖括号降级为死文本', () => {
    expect(tokenize('AT+FOO=<n')).toEqual([
      { type: 'literal', text: 'AT+FOO=' },
      { type: 'literal', text: '<n' },
    ]);
  });
});

describe('findPlaceholder', () => {
  it('定位第一个占位符区间', () => {
    expect(findPlaceholder('AT+CEREG=<n>')).toEqual({ start: 9, end: 12 });
  });
  it('从指定位置查找下一个', () => {
    const s = '+X: <a>,<b>';
    const first = findPlaceholder(s)!;
    const next = findPlaceholder(s, first.end);
    expect(next).toEqual({ start: 8, end: 11 });
  });
  it('无占位符返回 null', () => {
    expect(findPlaceholder('AT')).toBeNull();
  });
});

describe('longestCommonPrefix', () => {
  it('多字符串公共前缀', () => {
    expect(longestCommonPrefix(['AT+CEREG?', 'AT+CEREG=1', 'AT+CEREG=2'])).toBe('AT+CEREG');
  });
  it('单元素返回自身', () => {
    expect(longestCommonPrefix(['AT+CSQ'])).toBe('AT+CSQ');
  });
  it('无公共前缀返回空', () => {
    expect(longestCommonPrefix(['ABC', 'XYZ'])).toBe('');
  });
  it('空数组返回空', () => {
    expect(longestCommonPrefix([])).toBe('');
  });
});

describe('getRemainingHint', () => {
  it('输入停在死文本前，灰显整段模板剩余', () => {
    expect(getRemainingHint('AT+CEREG', 'AT+CEREG=<n>')).toBe('=<n>');
  });

  it('输入到 = 后，灰显占位符', () => {
    expect(getRemainingHint('AT+CEREG=', 'AT+CEREG=<n>')).toBe('<n>');
  });

  it('完全匹配返回空串', () => {
    expect(getRemainingHint('AT+CEREG=1', 'AT+CEREG=<n>')).toBe('');
  });

  it('死文本冲突返回 null', () => {
    expect(getRemainingHint('AT+XYZ', 'AT+CEREG=<n>')).toBeNull();
  });

  it('输入停在死文本中间，灰显该死文本剩余', () => {
    expect(getRemainingHint('AT+CE', 'AT+CEREG=<n>')).toBe('REG=<n>');
  });

  it('多占位符：填完第一个占位符与逗号后灰显末尾占位符', () => {
    // 模板 +CEREG: <stat>,<tac>，输入 "+CEREG: 1," 停在末尾占位符前 → 灰显 <tac> 提示继续填
    const hint = getRemainingHint('+CEREG: 1,', '+CEREG: <stat>,<tac>');
    expect(hint).toBe('<tac>');
  });

  it('多占位符：正在填末尾占位符时不再灰显（无后续死文本）', () => {
    // 输入 "+CEREG: 1,7" 已开始填 <tac> 且其后无死文本 → 无灰显
    const hint = getRemainingHint('+CEREG: 1,7', '+CEREG: <stat>,<tac>');
    expect(hint).toBe('');
  });
});

describe('parseBaseCmd', () => {
  it('去掉 = 参数', () => {
    expect(parseBaseCmd('AT+CEREG=2')).toBe('AT+CEREG');
  });
  it('去掉 ? 查询', () => {
    expect(parseBaseCmd('AT+CGSN?')).toBe('AT+CGSN');
  });
  it('去掉占位符', () => {
    expect(parseBaseCmd('AT+CEREG=<n>')).toBe('AT+CEREG');
  });
  it('无参数命令原样返回', () => {
    expect(parseBaseCmd('ATI')).toBe('ATI');
  });
  it('URC 形式去掉尾冒号', () => {
    expect(parseBaseCmd('+CEREG:')).toBe('+CEREG');
  });
  it('拨号命令', () => {
    expect(parseBaseCmd('ATD10086;')).toBe('ATD10086;');
  });
});

describe('classifyTemplate', () => {
  it('非 AT 开头判为 URC', () => {
    expect(classifyTemplate('+CEREG: 1,2')).toBe('urc');
  });
  it('=? 结尾判为 test', () => {
    expect(classifyTemplate('AT+CEREG=?')).toBe('test');
  });
  it('? 结尾判为 read', () => {
    expect(classifyTemplate('AT+CEREG?')).toBe('read');
  });
  it('含 = 判为 set', () => {
    expect(classifyTemplate('AT+CEREG=1')).toBe('set');
  });
  it('纯执行命令判为 exec', () => {
    expect(classifyTemplate('ATI')).toBe('exec');
    expect(classifyTemplate('AT')).toBe('exec');
  });
  it('大小写不敏感', () => {
    expect(classifyTemplate('at+cgsn=1')).toBe('set');
  });
});

describe('stripOptionalBrackets', () => {
  it('剥除可选组方括号，摊平为逗号分隔', () => {
    expect(stripOptionalBrackets('AT+CGDCONT=<cid>[,<PDP_type>[,<APN>]]')).toBe(
      'AT+CGDCONT=<cid>,<PDP_type>,<APN>',
    );
  });
  it('无括号原样返回', () => {
    expect(stripOptionalBrackets('AT+CEREG=<n>')).toBe('AT+CEREG=<n>');
  });
  it('去括号后可让 getRemainingHint 越过可选参数', () => {
    // 用户已填 cid=2 + PDP_type + APN，灰显应只剩后续可选参数
    const flat = stripOptionalBrackets('AT+CGDCONT=<cid>[,<PDP_type>[,<APN>[,<PDP_addr>[,<d_comp>[,<h_comp>]]]]]');
    const hint = getRemainingHint('AT+CGDCONT=2,"IP","test.apn"', flat);
    expect(hint).toBe(',<PDP_addr>,<d_comp>,<h_comp>');
  });
});
