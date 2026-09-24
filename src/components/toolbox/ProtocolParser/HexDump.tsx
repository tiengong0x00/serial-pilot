import { useMemo } from "react";

interface HexDumpProps {
  bytes: number[];
  /** 当前高亮字节区间 [start, end)，来自选中的解码节点 */
  activeRange: [number, number] | null;
  /** 点击某字节时回调其索引，用于反向定位解码节点 */
  onByteClick: (index: number) => void;
}

const BYTES_PER_ROW = 16;

const toHex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const printable = (n: number) => (n >= 0x20 && n <= 0x7e ? String.fromCharCode(n) : ".");

/**
 * hexdump 显示区：偏移 + 16 列十六进制 + ASCII 解码。
 * 与解码树联动：activeRange 内的字节高亮，点击字节回调索引。
 */
export const HexDump = ({ bytes, activeRange, onByteClick }: HexDumpProps) => {
  const rows = useMemo(() => {
    const out: number[][] = [];
    for (let i = 0; i < bytes.length; i += BYTES_PER_ROW) {
      out.push(bytes.slice(i, i + BYTES_PER_ROW));
    }
    return out;
  }, [bytes]);

  const isActive = (idx: number) =>
    activeRange !== null && idx >= activeRange[0] && idx < activeRange[1];

  if (bytes.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground font-mono">—</div>
    );
  }

  return (
    <div className="p-2 font-mono text-xs leading-6 overflow-auto">
      {rows.map((row, r) => {
        const base = r * BYTES_PER_ROW;
        return (
          <div key={r} className="flex gap-3 whitespace-pre">
            <span className="text-muted-foreground select-none">
              {base.toString(16).toUpperCase().padStart(4, "0")}
            </span>
            <span className="flex gap-1">
              {Array.from({ length: BYTES_PER_ROW }).map((_, c) => {
                const idx = base + c;
                if (idx >= bytes.length) return <span key={c} className="w-[1.1rem]">{"  "}</span>;
                const active = isActive(idx);
                return (
                  <span
                    key={c}
                    onClick={() => onByteClick(idx)}
                    className={"cursor-pointer rounded-sm px-0.5 " + (active ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                    title={"偏移 " + idx}
                  >
                    {toHex(row[c])}
                  </span>
                );
              })}
            </span>
            <span className="flex">
              {row.map((b, c) => {
                const idx = base + c;
                const active = isActive(idx);
                return (
                  <span
                    key={c}
                    onClick={() => onByteClick(idx)}
                    className={"cursor-pointer " + (active ? "bg-primary text-primary-foreground rounded-sm" : "hover:bg-muted text-muted-foreground")}
                  >
                    {printable(b)}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
};
