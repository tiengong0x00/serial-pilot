import { useState, useMemo } from "react";
import { Copy, Search } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useCommandLibrary } from "@/stores/commandLibraryStore";

const EmbeddedTools = () => {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<string>("ascii-table");

  const tools = [
    { id: "ascii-table", label: t("toolbox.toolAsciiTable") },
    { id: "serial-rate", label: t("toolbox.toolSerialRate") },
    { id: "at-reference", label: t("toolbox.toolAtReference") },
    { id: "modbus-rtu", label: t("toolbox.toolModbusRtu") },
    { id: "nmea-gps", label: t("toolbox.toolNmeaGps") },
    { id: "bit-field", label: t("toolbox.toolBitField") },
    { id: "power-calc", label: t("toolbox.toolPowerCalc") },
  ];

  return (
    <div className="flex h-full">
      {/* 工具列表 */}
      <div className="w-48 border-r bg-muted/20 p-3">
        <div className="flex flex-col gap-1">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`
                px-3 py-2 text-sm text-left rounded-md transition-colors
                ${
                  activeTool === tool.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }
              `}
            >
              {tool.label}
            </button>
          ))}
        </div>
      </div>

      {/* 工具内容区 */}
      <div className="flex-1 overflow-y-auto">
        {activeTool === "ascii-table" && <AsciiTable />}
        {activeTool === "serial-rate" && <SerialRateCalculator />}
        {activeTool === "at-reference" && <AtReference />}
        {activeTool === "modbus-rtu" && <ModbusRtu />}
        {activeTool === "nmea-gps" && <NmeaGpsParser />}
        {activeTool === "bit-field" && <BitFieldDecoder />}
        {activeTool === "power-calc" && <PowerCalculator />}
      </div>
    </div>
  );
};

export default EmbeddedTools;

// ==================== 工具1: ASCII 码表 ====================

// 控制字符（0-31 + 127）的助记符与标准英文名称
const CONTROL_CHARS: Record<number, { abbr: string; name: string }> = {
  0: { abbr: "NUL", name: "Null" },
  1: { abbr: "SOH", name: "Start of Heading" },
  2: { abbr: "STX", name: "Start of Text" },
  3: { abbr: "ETX", name: "End of Text" },
  4: { abbr: "EOT", name: "End of Transmission" },
  5: { abbr: "ENQ", name: "Enquiry" },
  6: { abbr: "ACK", name: "Acknowledge" },
  7: { abbr: "BEL", name: "Bell" },
  8: { abbr: "BS", name: "Backspace" },
  9: { abbr: "HT", name: "Horizontal Tab" },
  10: { abbr: "LF", name: "Line Feed" },
  11: { abbr: "VT", name: "Vertical Tab" },
  12: { abbr: "FF", name: "Form Feed" },
  13: { abbr: "CR", name: "Carriage Return" },
  14: { abbr: "SO", name: "Shift Out" },
  15: { abbr: "SI", name: "Shift In" },
  16: { abbr: "DLE", name: "Data Link Escape" },
  17: { abbr: "DC1", name: "Device Control 1 (XON)" },
  18: { abbr: "DC2", name: "Device Control 2" },
  19: { abbr: "DC3", name: "Device Control 3 (XOFF)" },
  20: { abbr: "DC4", name: "Device Control 4" },
  21: { abbr: "NAK", name: "Negative Acknowledge" },
  22: { abbr: "SYN", name: "Synchronous Idle" },
  23: { abbr: "ETB", name: "End of Transmission Block" },
  24: { abbr: "CAN", name: "Cancel" },
  25: { abbr: "EM", name: "End of Medium" },
  26: { abbr: "SUB", name: "Substitute" },
  27: { abbr: "ESC", name: "Escape" },
  28: { abbr: "FS", name: "File Separator" },
  29: { abbr: "GS", name: "Group Separator" },
  30: { abbr: "RS", name: "Record Separator" },
  31: { abbr: "US", name: "Unit Separator" },
  32: { abbr: "SP", name: "Space" },
  127: { abbr: "DEL", name: "Delete" },
};

interface AsciiEntry {
  dec: number;
  hex: string;
  oct: string;
  bin: string;
  char: string;
  desc: string;
}

const ASCII_ENTRIES: AsciiEntry[] = Array.from({ length: 128 }, (_, dec) => {
  const ctrl = CONTROL_CHARS[dec];
  return {
    dec,
    hex: dec.toString(16).toUpperCase().padStart(2, "0"),
    oct: dec.toString(8).padStart(3, "0"),
    bin: dec.toString(2).padStart(8, "0"),
    char: ctrl ? ctrl.abbr : String.fromCharCode(dec),
    desc: ctrl ? ctrl.name : "",
  };
});

const AsciiTable = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ASCII_ENTRIES;
    return ASCII_ENTRIES.filter(
      (e) =>
        e.dec.toString() === q ||
        e.hex.toLowerCase() === q ||
        e.hex.toLowerCase() === q.replace(/^0x/, "") ||
        e.char.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q)
    );
  }, [search]);

  const copyValue = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success(t("toolbox.copied"));
  };

  return (
    <ToolCard title={t("toolbox.asciiTableTitle")}>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("toolbox.asciiSearchPlaceholder")}
            className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="border border-input rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Dec</th>
                <th className="px-2 py-1.5 text-left">Hex</th>
                <th className="px-2 py-1.5 text-left">Oct</th>
                <th className="px-2 py-1.5 text-left">Bin</th>
                <th className="px-2 py-1.5 text-left">{t("toolbox.asciiChar")}</th>
                <th className="px-2 py-1.5 text-left">{t("toolbox.asciiDesc")}</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {filtered.map((e) => (
                <tr
                  key={e.dec}
                  onClick={() => copyValue(`0x${e.hex}`)}
                  className="border-t border-input hover:bg-accent cursor-pointer"
                  title={t("toolbox.asciiClickToCopy")}
                >
                  <td className="px-2 py-1">{e.dec}</td>
                  <td className="px-2 py-1">0x{e.hex}</td>
                  <td className="px-2 py-1">{e.oct}</td>
                  <td className="px-2 py-1">{e.bin}</td>
                  <td className="px-2 py-1 font-semibold">{e.char}</td>
                  <td className="px-2 py-1 font-sans text-muted-foreground">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ToolCard>
  );
};

// ==================== 工具2: 串口速率/吞吐计算 ====================
const COMMON_BAUD_RATES = [
  9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000, 3000000,
];

const SerialRateCalculator = () => {
  const { t } = useTranslation();
  const [baud, setBaud] = useState(115200);
  const [dataBits, setDataBits] = useState(8);
  const [parity, setParity] = useState<"none" | "even" | "odd">("none");
  const [stopBits, setStopBits] = useState(1);

  // 吞吐估算输入
  const [dataSize, setDataSize] = useState(1024); // 字节
  // 利用率输入
  const [measuredBytes, setMeasuredBytes] = useState(0);
  const [measuredMs, setMeasuredMs] = useState(0);

  // 每字节位数 = 起始位(1) + 数据位 + 校验位(0/1) + 停止位
  const bitsPerByte = 1 + dataBits + (parity === "none" ? 0 : 1) + stopBits;
  // 理论最大字节/秒
  const maxBytesPerSec = baud / bitsPerByte;
  // 每字节耗时（微秒）
  const usPerByte = (bitsPerByte / baud) * 1_000_000;

  // 传输 dataSize 字节的理论耗时（毫秒）
  const transferMs = (dataSize / maxBytesPerSec) * 1000;

  // 实测利用率
  const measuredRate = measuredMs > 0 ? (measuredBytes / measuredMs) * 1000 : 0;
  const utilization = maxBytesPerSec > 0 ? (measuredRate / maxBytesPerSec) * 100 : 0;

  const fmt = (n: number, digits = 2) =>
    n.toLocaleString(undefined, { maximumFractionDigits: digits });

  return (
    <ToolCard title={t("toolbox.serialRateTitle")}>
      <div className="space-y-5">
        {/* 帧格式配置 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">{t("toolbox.baudRate")}</label>
            <input
              type="number"
              min={1}
              value={baud}
              onChange={(e) => setBaud(Math.max(1, Number(e.target.value) || 1))}
              list="baud-list"
              className="w-full h-9 mt-1.5 px-3 text-sm rounded-md border border-input bg-background font-mono"
            />
            <datalist id="baud-list">
              {COMMON_BAUD_RATES.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-sm font-medium">{t("toolbox.dataBits")}</label>
            <select
              value={dataBits}
              onChange={(e) => setDataBits(Number(e.target.value))}
              className="w-full h-9 mt-1.5 px-2 text-sm rounded-md border border-input bg-background"
            >
              {[5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">{t("toolbox.parity")}</label>
            <select
              value={parity}
              onChange={(e) => setParity(e.target.value as "none" | "even" | "odd")}
              className="w-full h-9 mt-1.5 px-2 text-sm rounded-md border border-input bg-background"
            >
              <option value="none">{t("toolbox.parityNone")}</option>
              <option value="even">{t("toolbox.parityEven")}</option>
              <option value="odd">{t("toolbox.parityOdd")}</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">{t("toolbox.stopBits")}</label>
            <select
              value={stopBits}
              onChange={(e) => setStopBits(Number(e.target.value))}
              className="w-full h-9 mt-1.5 px-2 text-sm rounded-md border border-input bg-background"
            >
              {[1, 2].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 理论最大速率 */}
        <div className="grid grid-cols-2 gap-3">
          <StatBox
            label={t("toolbox.theoreticalMaxRate")}
            value={`${fmt(maxBytesPerSec)} B/s`}
            hint={`${fmt(maxBytesPerSec / 1024)} KB/s`}
          />
          <StatBox
            label={t("toolbox.bitsPerByte")}
            value={`${bitsPerByte} bit`}
            hint={`${fmt(usPerByte)} μs/${t("toolbox.byte")}`}
          />
        </div>

        {/* 传输耗时估算 */}
        <div className="pt-3 border-t">
          <label className="text-sm font-medium">{t("toolbox.transferEstimate")}</label>
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="number"
              min={0}
              value={dataSize}
              onChange={(e) => setDataSize(Math.max(0, Number(e.target.value) || 0))}
              className="w-32 h-9 px-3 text-sm rounded-md border border-input bg-background font-mono"
            />
            <span className="text-sm text-muted-foreground">{t("toolbox.bytes")}</span>
            <span className="text-sm text-muted-foreground">→</span>
            <span className="text-sm font-mono font-semibold">
              {fmt(transferMs)} ms
            </span>
          </div>
        </div>

        {/* 实测利用率 */}
        <div className="pt-3 border-t">
          <label className="text-sm font-medium">{t("toolbox.utilizationCalc")}</label>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <input
              type="number"
              min={0}
              value={measuredBytes}
              onChange={(e) => setMeasuredBytes(Math.max(0, Number(e.target.value) || 0))}
              placeholder={t("toolbox.measuredBytes")}
              className="w-28 h-9 px-3 text-sm rounded-md border border-input bg-background font-mono"
            />
            <span className="text-sm text-muted-foreground">{t("toolbox.bytes")} /</span>
            <input
              type="number"
              min={0}
              value={measuredMs}
              onChange={(e) => setMeasuredMs(Math.max(0, Number(e.target.value) || 0))}
              placeholder="ms"
              className="w-24 h-9 px-3 text-sm rounded-md border border-input bg-background font-mono"
            />
            <span className="text-sm text-muted-foreground">ms</span>
          </div>
          {measuredMs > 0 && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <StatBox
                label={t("toolbox.measuredRate")}
                value={`${fmt(measuredRate)} B/s`}
              />
              <StatBox
                label={t("toolbox.utilization")}
                value={`${fmt(utilization, 1)} %`}
                hint={
                  utilization > 95
                    ? t("toolbox.utilizationHigh")
                    : utilization < 50
                    ? t("toolbox.utilizationLow")
                    : undefined
                }
              />
            </div>
          )}
        </div>
      </div>
    </ToolCard>
  );
};

// ==================== 工具3: AT 指令速查 ====================
const AtReference = () => {
  const { t } = useTranslation();
  const commands = useCommandLibrary((s) => s.commands);
  const loaded = useCommandLibrary((s) => s.loaded);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.command.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    );
  }, [search, commands]);

  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    toast.success(t("toolbox.copied"));
  };

  return (
    <ToolCard title={t("toolbox.atReferenceTitle")}>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("toolbox.atSearchPlaceholder")}
            className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="text-xs text-muted-foreground">
          {t("toolbox.atCommandCount", { count: filtered.length })}
        </div>

        {!loaded ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {t("toolbox.atLoading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {t("toolbox.atNoResult")}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c, idx) => (
              <div
                key={`${c.command}-${idx}`}
                className="p-3 rounded-md border border-input bg-muted/20 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono font-semibold">{c.command}</code>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                      {c.category}
                    </span>
                  </div>
                  <button
                    onClick={() => copyCommand(c.command)}
                    className="p-1 hover:bg-muted rounded shrink-0"
                    title={t("toolbox.copy")}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{c.description}</p>
                {c.example && (
                  <code className="text-xs font-mono text-muted-foreground mt-1 block">
                    {t("toolbox.atExample")}: {c.example}
                  </code>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  );
};

// ==================== 工具4: Modbus RTU 构造/解析 ====================

// CRC16-MODBUS（返回 [低字节, 高字节]，Modbus 帧中 CRC 低字节在前）
const crc16ModbusBytes = (data: number[]): [number, number] => {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x0001 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return [crc & 0xff, (crc >> 8) & 0xff];
};

const toHexByte = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const bytesToHexStr = (bytes: number[]) => bytes.map(toHexByte).join(" ");

// 解析 hex 字符串为字节数组，非法返回 null
const parseHexBytes = (input: string): number[] | null => {
  const cleaned = input.replace(/[^0-9A-Fa-f]/g, "");
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  return cleaned.match(/.{1,2}/g)!.map((b) => parseInt(b, 16));
};

const MODBUS_FUNCTIONS = [
  { code: 0x01, key: "toolbox.modbusFunc01" },
  { code: 0x02, key: "toolbox.modbusFunc02" },
  { code: 0x03, key: "toolbox.modbusFunc03" },
  { code: 0x04, key: "toolbox.modbusFunc04" },
  { code: 0x05, key: "toolbox.modbusFunc05" },
  { code: 0x06, key: "toolbox.modbusFunc06" },
  { code: 0x10, key: "toolbox.modbusFunc10" },
];

const ModbusRtu = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"build" | "parse">("build");

  // 构造参数
  const [slaveAddr, setSlaveAddr] = useState(1);
  const [funcCode, setFuncCode] = useState(0x03);
  const [startReg, setStartReg] = useState(0);
  const [quantity, setQuantity] = useState(10);

  const builtFrame = useMemo(() => {
    // 帧体：从站地址 + 功能码 + 起始地址(2字节) + 数量/值(2字节)
    const body = [
      slaveAddr & 0xff,
      funcCode & 0xff,
      (startReg >> 8) & 0xff,
      startReg & 0xff,
      (quantity >> 8) & 0xff,
      quantity & 0xff,
    ];
    const [crcLo, crcHi] = crc16ModbusBytes(body);
    return bytesToHexStr([...body, crcLo, crcHi]);
  }, [slaveAddr, funcCode, startReg, quantity]);

  // 解析
  const [parseInput, setParseInput] = useState("");
  const parsed = useMemo(() => {
    const bytes = parseHexBytes(parseInput);
    if (!bytes || bytes.length < 4) return null;

    const dataBytes = bytes.slice(0, -2);
    const [crcLo, crcHi] = crc16ModbusBytes(dataBytes);
    const givenCrc = [bytes[bytes.length - 2], bytes[bytes.length - 1]];
    const crcValid = crcLo === givenCrc[0] && crcHi === givenCrc[1];

    return {
      slave: bytes[0],
      func: bytes[1],
      funcKey: MODBUS_FUNCTIONS.find((f) => f.code === bytes[1])?.key ?? "",
      data: bytes.slice(2, -2),
      crc: `${toHexByte(givenCrc[0])} ${toHexByte(givenCrc[1])}`,
      crcCalc: `${toHexByte(crcLo)} ${toHexByte(crcHi)}`,
      crcValid,
    };
  }, [parseInput]);

  return (
    <ToolCard title={t("toolbox.modbusRtuTitle")}>
      <div className="space-y-4">
        {/* 模式切换 */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode("build")}
            className={`px-3 py-1 text-sm rounded border transition-colors ${
              mode === "build"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input hover:bg-muted"
            }`}
          >
            {t("toolbox.modbusBuild")}
          </button>
          <button
            onClick={() => setMode("parse")}
            className={`px-3 py-1 text-sm rounded border transition-colors ${
              mode === "parse"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input hover:bg-muted"
            }`}
          >
            {t("toolbox.modbusParse")}
          </button>
        </div>

        {mode === "build" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">{t("toolbox.modbusSlaveAddr")}</label>
                <input
                  type="number"
                  min={0}
                  max={247}
                  value={slaveAddr}
                  onChange={(e) => setSlaveAddr(Math.max(0, Math.min(247, Number(e.target.value) || 0)))}
                  className="w-full h-9 mt-1.5 px-3 text-sm rounded-md border border-input bg-background font-mono"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("toolbox.modbusFuncCode")}</label>
                <select
                  value={funcCode}
                  onChange={(e) => setFuncCode(Number(e.target.value))}
                  className="w-full h-9 mt-1.5 px-2 text-sm rounded-md border border-input bg-background"
                >
                  {MODBUS_FUNCTIONS.map((f) => (
                    <option key={f.code} value={f.code}>{t(f.key)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">{t("toolbox.modbusStartReg")}</label>
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={startReg}
                  onChange={(e) => setStartReg(Math.max(0, Math.min(65535, Number(e.target.value) || 0)))}
                  className="w-full h-9 mt-1.5 px-3 text-sm rounded-md border border-input bg-background font-mono"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("toolbox.modbusQuantity")}</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(65535, Number(e.target.value) || 1)))}
                  className="w-full h-9 mt-1.5 px-3 text-sm rounded-md border border-input bg-background font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{t("toolbox.modbusFrame")}</label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(builtFrame);
                    toast.success(t("toolbox.copied"));
                  }}
                  className="p-1 hover:bg-muted rounded"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 font-mono break-all">
                {builtFrame}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("toolbox.modbusParseInput")}</label>
              <textarea
                className="w-full h-20 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                value={parseInput}
                onChange={(e) => setParseInput(e.target.value)}
                placeholder="01 03 14 00 0A ... CRC"
              />
            </div>

            {parsed && (
              <div className="space-y-2">
                <ParseRow label={t("toolbox.modbusSlaveAddr")} value={`0x${toHexByte(parsed.slave)} (${parsed.slave})`} />
                <ParseRow label={t("toolbox.modbusFuncCode")} value={`0x${toHexByte(parsed.func)} — ${parsed.funcKey ? t(parsed.funcKey) : "?"}`} />
                <ParseRow label={t("toolbox.modbusData")} value={parsed.data.length ? bytesToHexStr(parsed.data) : "—"} />
                <ParseRow
                  label="CRC"
                  value={parsed.crcValid
                    ? `${parsed.crc} ✓ ${t("toolbox.modbusCrcOk")}`
                    : `${parsed.crc} ✗ ${t("toolbox.modbusCrcErr")} (${t("toolbox.modbusCrcCalc")}: ${parsed.crcCalc})`}
                  error={!parsed.crcValid}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </ToolCard>
  );
};

const ParseRow = ({ label, value, error }: { label: string; value: string; error?: boolean }) => (
  <div className="flex items-start gap-2 text-sm">
    <span className="text-muted-foreground w-24 shrink-0">{label}:</span>
    <span className={`font-mono break-all ${error ? "text-destructive" : ""}`}>{value}</span>
  </div>
);

// ==================== 工具5: NMEA/GPS 解析 ====================

// NMEA 度分格式(ddmm.mmmm)转十进制度
const nmeaToDecimal = (val: string, dir: string): number | null => {
  if (!val) return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;
  const deg = Math.floor(num / 100);
  const min = num - deg * 100;
  let decimal = deg + min / 60;
  if (dir === "S" || dir === "W") decimal = -decimal;
  return decimal;
};

const nmeaTime = (val: string): string => {
  if (!val || val.length < 6) return "";
  return `${val.slice(0, 2)}:${val.slice(2, 4)}:${val.slice(4, 6)} UTC`;
};

const parseNmeaSentence = (line: string, t: (key: string) => string): { type: string; fields: [string, string][] } | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("$")) return null;
  // 去掉校验和部分
  const body = trimmed.split("*")[0].slice(1);
  const parts = body.split(",");
  const type = parts[0];
  const suffix = type.slice(-3); // GGA/RMC/...

  const fields: [string, string][] = [];

  if (suffix === "GGA") {
    fields.push([t("toolbox.nmeaUtcTime"), nmeaTime(parts[1])]);
    const lat = nmeaToDecimal(parts[2], parts[3]);
    const lon = nmeaToDecimal(parts[4], parts[5]);
    fields.push([t("toolbox.nmeaLatitude"), lat !== null ? `${lat.toFixed(6)}°` : "—"]);
    fields.push([t("toolbox.nmeaLongitude"), lon !== null ? `${lon.toFixed(6)}°` : "—"]);
    const fixMap: Record<string, string> = {
      "0": t("toolbox.nmeaFixInvalid"),
      "1": t("toolbox.nmeaFixGps"),
      "2": t("toolbox.nmeaFixDgps")
    };
    fields.push([t("toolbox.nmeaFixQuality"), fixMap[parts[6]] ?? parts[6] ?? "—"]);
    fields.push([t("toolbox.nmeaSatellites"), parts[7] || "—"]);
    fields.push(["HDOP", parts[8] || "—"]);
    fields.push([t("toolbox.nmeaAltitude"), parts[9] ? `${parts[9]} ${parts[10] || "m"}` : "—"]);
  } else if (suffix === "RMC") {
    fields.push([t("toolbox.nmeaUtcTime"), nmeaTime(parts[1])]);
    fields.push([t("toolbox.nmeaStatus"), parts[2] === "A" ? t("toolbox.nmeaStatusValid") : t("toolbox.nmeaStatusInvalid")]);
    const lat = nmeaToDecimal(parts[3], parts[4]);
    const lon = nmeaToDecimal(parts[5], parts[6]);
    fields.push([t("toolbox.nmeaLatitude"), lat !== null ? `${lat.toFixed(6)}°` : "—"]);
    fields.push([t("toolbox.nmeaLongitude"), lon !== null ? `${lon.toFixed(6)}°` : "—"]);
    fields.push([t("toolbox.nmeaSpeed"), parts[7] ? `${parts[7]} 节` : "—"]);
    fields.push([t("toolbox.nmeaCourse"), parts[8] ? `${parts[8]}°` : "—"]);
    fields.push([t("toolbox.nmeaDate"), parts[9] && parts[9].length === 6
      ? `20${parts[9].slice(4, 6)}-${parts[9].slice(2, 4)}-${parts[9].slice(0, 2)}`
      : "—"]);
  } else if (suffix === "GSV") {
    fields.push([t("toolbox.nmeaMsgTotal"), parts[1] || "—"]);
    fields.push([t("toolbox.nmeaMsgCurrent"), parts[2] || "—"]);
    fields.push([t("toolbox.nmeaSatsVisible"), parts[3] || "—"]);
  } else if (suffix === "GSA") {
    const modeMap: Record<string, string> = {
      "1": t("toolbox.nmeaModeNoFix"),
      "2": t("toolbox.nmeaMode2d"),
      "3": t("toolbox.nmeaMode3d")
    };
    fields.push([t("toolbox.nmeaFixMode"), modeMap[parts[2]] ?? parts[2] ?? "—"]);
    fields.push(["PDOP", parts[15] || "—"]);
    fields.push(["HDOP", parts[16] || "—"]);
    fields.push(["VDOP", (parts[17] || "").split("*")[0] || "—"]);
  } else if (suffix === "VTG") {
    fields.push([t("toolbox.nmeaTrueCourse"), parts[1] ? `${parts[1]}°` : "—"]);
    fields.push([t("toolbox.nmeaGroundSpeed"), parts[5] ? `${parts[5]} 节` : "—"]);
    fields.push([t("toolbox.nmeaGroundSpeed"), parts[7] ? `${parts[7]} km/h` : "—"]);
  } else {
    return { type, fields: [[t("toolbox.nmeaRawFields"), parts.slice(1).join(", ")]] };
  }

  return { type, fields };
};

const NmeaGpsParser = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  const results = useMemo(() => {
    return input
      .split(/[\r\n]+/)
      .map((line) => parseNmeaSentence(line, t))
      .filter((r): r is { type: string; fields: [string, string][] } => r !== null);
  }, [input, t]);

  return (
    <ToolCard title={t("toolbox.nmeaGpsTitle")}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t("toolbox.nmeaInput")}</label>
          <textarea
            className="w-full h-28 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"
          />
          <p className="text-xs text-muted-foreground mt-1">{t("toolbox.nmeaHint")}</p>
        </div>

        {results.length > 0 && (
          <div className="space-y-3">
            {results.map((r, idx) => (
              <div key={idx} className="border border-input rounded-md overflow-hidden">
                <div className="px-3 py-1.5 bg-muted/50 text-sm font-mono font-semibold">
                  {r.type}
                </div>
                <div className="p-3 space-y-1.5">
                  {r.fields.map(([label, value], i) => (
                    <ParseRow key={i} label={label} value={value} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  );
};

// ==================== 工具6: 二进制位字段解析 ====================

const BitFieldDecoder = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [bitWidth, setBitWidth] = useState<8 | 16 | 32>(8);

  const parsed = useMemo(() => {
    const cleaned = input.trim().replace(/^0x/i, "");
    const num = parseInt(cleaned, 16);
    if (isNaN(num)) return null;

    const bits: { index: number; value: 0 | 1 }[] = [];
    for (let i = 0; i < bitWidth; i++) {
      bits.push({ index: i, value: (num >> i) & 1 ? 1 : 0 });
    }
    bits.reverse(); // 高位在前

    return {
      hex: `0x${num.toString(16).toUpperCase().padStart(bitWidth / 4, "0")}`,
      dec: num,
      bin: num.toString(2).padStart(bitWidth, "0"),
      bits,
    };
  }, [input, bitWidth]);

  return (
    <ToolCard title={t("toolbox.bitFieldTitle")}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium">{t("toolbox.bitFieldInput")}</label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x8A"
              className="w-full h-9 mt-1.5 px-3 text-sm rounded-md border border-input bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("toolbox.bitWidth")}</label>
            <select
              value={bitWidth}
              onChange={(e) => setBitWidth(Number(e.target.value) as 8 | 16 | 32)}
              className="w-20 h-9 mt-1.5 px-2 text-sm rounded-md border border-input bg-background"
            >
              <option value={8}>8</option>
              <option value={16}>16</option>
              <option value={32}>32</option>
            </select>
          </div>
        </div>

        {parsed && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Hex" value={parsed.hex} />
              <StatBox label="Dec" value={String(parsed.dec)} />
              <StatBox label="Bin" value={parsed.bin} />
            </div>

            <div>
              <div className="text-sm font-medium mb-2">{t("toolbox.bitFieldMap")}</div>
              <div className="border border-input rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left w-16">{t("toolbox.bitIndex")}</th>
                      <th className="px-2 py-1 text-center w-12">{t("toolbox.bitValue")}</th>
                      <th className="px-2 py-1 text-left">{t("toolbox.bitDesc")}</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {parsed.bits.map((b) => (
                      <tr
                        key={b.index}
                        className={`border-t border-input ${
                          b.value === 1 ? "bg-primary/10" : ""
                        }`}
                      >
                        <td className="px-2 py-1.5">Bit{b.index}</td>
                        <td className="px-2 py-1.5 text-center font-semibold">
                          {b.value}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {b.value === 1 ? t("toolbox.bitSet") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t("toolbox.bitFieldHint")}
              </p>
            </div>
          </>
        )}
      </div>
    </ToolCard>
  );
};

// ==================== 工具7: 功耗估算 ====================

interface PowerMode {
  id: number;
  name: string;
  current: number; // mA
  duration: number; // 秒（每周期）
}

let powerModeId = 0;

const PowerCalculator = () => {
  const { t } = useTranslation();
  const [battery, setBattery] = useState(2000); // mAh
  const [dod, setDod] = useState(80); // 放电深度 %
  const [modes, setModes] = useState<PowerMode[]>([
    { id: ++powerModeId, name: t("toolbox.powerStandby"), current: 5, duration: 50 },
    { id: ++powerModeId, name: t("toolbox.powerActive"), current: 150, duration: 10 },
  ]);

  const cycleSeconds = modes.reduce((sum, m) => sum + m.duration, 0);
  // 每周期能耗 mAh = Σ(电流 mA × 时长 h)
  const cycleMah = modes.reduce((sum, m) => sum + (m.current * m.duration) / 3600, 0);
  // 平均电流 mA = 每周期能耗 / 周期时长(h)
  const avgCurrent = cycleSeconds > 0 ? cycleMah / (cycleSeconds / 3600) : 0;
  // 可用容量
  const usableMah = battery * (dod / 100);
  // 续航小时
  const lifeHours = avgCurrent > 0 ? usableMah / avgCurrent : 0;

  const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d });

  const updateMode = (id: number, patch: Partial<PowerMode>) => {
    setModes((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  return (
    <ToolCard title={t("toolbox.powerCalcTitle")}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">{t("toolbox.batteryCapacity")}</label>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                type="number"
                min={1}
                value={battery}
                onChange={(e) => setBattery(Math.max(1, Number(e.target.value) || 1))}
                className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background font-mono"
              />
              <span className="text-sm text-muted-foreground">mAh</span>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">{t("toolbox.dischargeDepth")}</label>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                type="number"
                min={1}
                max={100}
                value={dod}
                onChange={(e) => setDod(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background font-mono"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        {/* 工作模式列表 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">{t("toolbox.powerModes")}</label>
            <button
              onClick={() =>
                setModes((prev) => [
                  ...prev,
                  { id: ++powerModeId, name: t("toolbox.powerNewMode"), current: 10, duration: 1 },
                ])
              }
              className="text-xs px-2 py-1 rounded btn-secondary"
            >
              + {t("toolbox.powerAddMode")}
            </button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_80px_32px] gap-2 text-xs text-muted-foreground px-1">
              <span>{t("toolbox.powerModeName")}</span>
              <span>{t("toolbox.powerCurrent")}</span>
              <span>{t("toolbox.powerDuration")}</span>
              <span></span>
            </div>
            {modes.map((m) => (
              <div key={m.id} className="grid grid-cols-[1fr_80px_80px_32px] gap-2 items-center">
                <input
                  type="text"
                  value={m.name}
                  onChange={(e) => updateMode(m.id, { name: e.target.value })}
                  className="h-8 px-2 text-sm rounded border border-input bg-background"
                />
                <input
                  type="number"
                  min={0}
                  value={m.current}
                  onChange={(e) => updateMode(m.id, { current: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-8 px-2 text-sm rounded border border-input bg-background font-mono"
                  title="mA"
                />
                <input
                  type="number"
                  min={0}
                  value={m.duration}
                  onChange={(e) => updateMode(m.id, { duration: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-8 px-2 text-sm rounded border border-input bg-background font-mono"
                  title="s"
                />
                <button
                  onClick={() => setModes((prev) => prev.filter((x) => x.id !== m.id))}
                  className="h-8 text-destructive hover:bg-muted rounded text-lg leading-none"
                  disabled={modes.length <= 1}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {t("toolbox.powerModeHint")}
          </p>
        </div>

        {/* 计算结果 */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t">
          <StatBox label={t("toolbox.powerAvgCurrent")} value={`${fmt(avgCurrent)} mA`} />
          <StatBox label={t("toolbox.powerCycleEnergy")} value={`${fmt(cycleMah, 4)} mAh`} hint={`${cycleSeconds}s/${t("toolbox.powerCycle")}`} />
          <StatBox
            label={t("toolbox.powerLife")}
            value={lifeHours >= 24 ? `${fmt(lifeHours / 24, 1)} ${t("toolbox.powerDays")}` : `${fmt(lifeHours, 1)} ${t("toolbox.powerHours")}`}
            hint={`${fmt(lifeHours, 1)} ${t("toolbox.powerHours")}`}
          />
          <StatBox label={t("toolbox.powerUsableCapacity")} value={`${fmt(usableMah)} mAh`} hint={`${dod}% DoD`} />
        </div>
      </div>
    </ToolCard>
  );
};

// ==================== 通用组件 ====================
const ToolCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="p-6">
    <h2 className="text-lg font-semibold mb-4">{title}</h2>
    {children}
  </div>
);

const StatBox = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="p-3 rounded-md border border-input bg-muted/30">
    <div className="text-xs text-muted-foreground mb-1">{label}</div>
    <div className="text-xl font-semibold font-mono">{value}</div>
    {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
  </div>
);
