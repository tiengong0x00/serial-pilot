/**
 * AT 命令库 + Trie 前缀匹配（运行时加载）
 *
 * 命令库从 .exe/../commands/*.json 动态加载，不再编译期硬编码。
 * Trie 树结构保留，加速输入时的前缀匹配。
 */

/** AT 命令分类（推荐使用预设值，也可自定义） */
export type AtCategory = "info" | "network" | "sim" | "call" | "sms" | "general" | (string & {});

/** 单条 AT 命令定义 */
export interface AtCommand {
  /** 命令语法，如 "AT+CSQ" */
  command: string;
  /** 分类 */
  category: AtCategory;
  /** 简短说明 */
  description: string;
  /** 用法示例（可选） */
  example?: string;
}

/** Trie 节点 */
interface TrieNode {
  children: Map<string, TrieNode>;
  /** 以该节点为结尾的命令索引（指向传入的命令数组） */
  indices: number[];
}

function createNode(): TrieNode {
  return { children: new Map(), indices: [] };
}

/**
 * AT 命令 Trie 树，用于前缀匹配。
 *
 * 大小写不敏感（统一转大写存储与查询）。
 * 每个节点记录经过它的所有命令索引，便于前缀查询直接返回。
 */
export class AtCommandTrie {
  private root: TrieNode = createNode();
  private commands: AtCommand[];

  constructor(commands: AtCommand[]) {
    this.commands = commands;
    commands.forEach((cmd, index) => this.insert(cmd.command, index));
  }

  private insert(command: string, index: number): void {
    let node = this.root;
    const key = command.toUpperCase();
    for (const ch of key) {
      let child = node.children.get(ch);
      if (!child) {
        child = createNode();
        node.children.set(ch, child);
      }
      node = child;
      node.indices.push(index); // 记录经过此节点的命令
    }
  }

  /**
   * 查询以 prefix 开头的命令索引列表。
   * 空前缀返回空数组（不主动弹出全部命令）。
   */
  search(prefix: string): number[] {
    const key = prefix.toUpperCase();
    if (key.length === 0) return [];
    let node = this.root;
    for (const ch of key) {
      const child = node.children.get(ch);
      if (!child) return []; // 无匹配
      node = child;
    }
    return node.indices;
  }

  /**
   * 匹配 AT 命令。
   * @param prefix 输入前缀
   * @param limit 最大候选数
   * @returns 匹配的命令列表
   */
  match(prefix: string, limit = 8): AtCommand[] {
    const indices = this.search(prefix.trim());
    return indices.slice(0, limit).map((i) => this.commands[i]);
  }
}
