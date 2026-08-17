/**
 * 终端高亮配置类型定义
 */

export type HighlightMatchType = 'text' | 'regex';

export interface HighlightRule {
  id: string;
  enabled: boolean;
  name: string;                    // 规则名称（用户备注）
  matchType: HighlightMatchType;
  pattern: string;                 // 匹配内容（固定字符或正则表达式）
  caseSensitive?: boolean;         // 大小写敏感（仅文本匹配）
  style: {
    color?: string;                // 前景色 #rrggbb
    backgroundColor?: string;       // 背景色 #rrggbb
    fontWeight?: 'bold' | 'normal';
    fontStyle?: 'italic' | 'normal';
  };
}

/**
 * 高亮匹配结果
 */
export interface HighlightMatch {
  start: number;
  end: number;
  rule: HighlightRule;
}
