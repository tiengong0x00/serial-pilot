import { useState } from "react";
import { Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const ConversionTools = () => {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<string>("hex-string");

  const tools = [
    { id: "hex-string", label: t("toolbox.toolHexString") },
    { id: "base64", label: t("toolbox.toolBase64") },
    { id: "radix", label: t("toolbox.toolRadix") },
    { id: "crc", label: t("toolbox.toolCrc") },
    { id: "endian", label: t("toolbox.toolEndian") },
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
        {activeTool === "hex-string" && <HexStringConverter />}
        {activeTool === "base64" && <Base64Converter />}
        {activeTool === "radix" && <RadixConverter />}
        {activeTool === "crc" && <CrcCalculator />}
        {activeTool === "endian" && <EndianConverter />}
      </div>
    </div>
  );
};

export default ConversionTools;

// ==================== 工具1: Hex ↔ String ====================
const HexStringConverter = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [encoding, setEncoding] = useState<"utf8" | "ascii">("utf8");
  const [spaceSeparated, setSpaceSeparated] = useState(true);
  const [direction, setDirection] = useState<"hex2str" | "str2hex">("hex2str");

  const hexToString = (hex: string, enc: "utf8" | "ascii"): string => {
    try {
      const cleaned = hex.replace(/[^0-9A-Fa-f]/g, "");
      if (cleaned.length % 2 !== 0) throw new Error(t("toolbox.errorHexEvenLength"));
      const bytes = new Uint8Array(
        cleaned.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []
      );
      return new TextDecoder(enc === "utf8" ? "utf-8" : "ascii").decode(bytes);
    } catch (e) {
      throw new Error(`${t("toolbox.errorConversionFailed")}: ${(e as Error).message}`);
    }
  };

  const stringToHex = (str: string, spaced: boolean): string => {
    const bytes = new TextEncoder().encode(str);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
    return spaced ? hex.join(" ").toUpperCase() : hex.join("").toUpperCase();
  };

  const handleConvert = () => {
    try {
      if (!input.trim()) {
        setOutput("");
        return;
      }
      if (direction === "hex2str") {
        setOutput(hexToString(input, encoding));
      } else {
        setOutput(stringToHex(input, spaceSeparated));
      }
    } catch (e) {
      toast.error((e as Error).message);
      setOutput("");
    }
  };

  const handleSwap = () => {
    setDirection((prev) => (prev === "hex2str" ? "str2hex" : "hex2str"));
    setInput(output);
    setOutput(input);
  };

  return (
    <ToolCard title={t("toolbox.hexStringTitle")}>
      <div className="space-y-4">
        {/* 方向选择 */}
        <div className="flex gap-2 items-center">
          <label className="text-sm font-medium">{t("toolbox.direction")}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setDirection("hex2str")}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                direction === "hex2str"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.hexToString")}
            </button>
            <button
              onClick={() => setDirection("str2hex")}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                direction === "str2hex"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.stringToHex")}
            </button>
          </div>
          <button
            onClick={handleSwap}
            className="ml-2 p-1.5 rounded hover:bg-muted transition-colors"
            title={t("toolbox.swapInputOutput")}
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* 输入 */}
        <div>
          <label className="text-sm font-medium">
            {t("toolbox.input")} {direction === "hex2str" ? "(Hex)" : "(String)"}
          </label>
          <textarea
            className="w-full h-32 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              direction === "hex2str" ? "48656C6C6F Or 48 65 6C 6C 6F" : "Hello"
            }
          />
        </div>

        {/* 参数 */}
        <div className="flex gap-4 flex-wrap">
          {direction === "hex2str" && (
            <div className="flex items-center gap-2">
              <label className="text-sm">{t("toolbox.encoding")}</label>
              <select
                className="h-8 px-2 text-sm rounded border border-input bg-background"
                value={encoding}
                onChange={(e) => setEncoding(e.target.value as "utf8" | "ascii")}
              >
                <option value="utf8">UTF-8</option>
                <option value="ascii">ASCII</option>
              </select>
            </div>
          )}
          {direction === "str2hex" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={spaceSeparated}
                onChange={(e) => setSpaceSeparated(e.target.checked)}
                className="rounded border-input"
              />
              {t("toolbox.spaceSeparated")}
            </label>
          )}
        </div>

        {/* 按钮 */}
        <div className="flex gap-2">
          <button onClick={handleConvert} className="btn-connect">
            {t("toolbox.convert")}
          </button>
          <button
            onClick={() => {
              setInput("");
              setOutput("");
            }}
            className="btn-secondary"
          >
            {t("toolbox.clear")}
          </button>
          <button
            onClick={() => {
              if (output) {
                navigator.clipboard.writeText(output);
                toast.success(t("toolbox.copied"));
              }
            }}
            className="btn-secondary flex items-center gap-1.5"
            disabled={!output}
          >
            <Copy className="w-3.5 h-3.5" />
            {t("toolbox.copyResult")}
          </button>
        </div>

        {/* 输出 */}
        <div>
          <label className="text-sm font-medium">
            {t("toolbox.output")} {direction === "hex2str" ? "(String)" : "(Hex)"}
          </label>
          <textarea
            className="w-full h-32 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 focus:outline-none font-mono"
            value={output}
            readOnly
            placeholder={t("toolbox.resultPlaceholder")}
          />
        </div>
      </div>
    </ToolCard>
  );
};

// ==================== 工具2: Base64 编解码 ====================
const Base64Converter = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [direction, setDirection] = useState<"encode" | "decode">("encode");

  const handleConvert = () => {
    try {
      if (!input.trim()) {
        setOutput("");
        return;
      }
      if (direction === "encode") {
        setOutput(btoa(unescape(encodeURIComponent(input))));
      } else {
        setOutput(decodeURIComponent(escape(atob(input))));
      }
    } catch (e) {
      toast.error(`${t("toolbox.errorConversionFailed")}: ${(e as Error).message}`);
      setOutput("");
    }
  };

  return (
    <ToolCard title={t("toolbox.base64Title")}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setDirection("encode")}
            className={`px-3 py-1 text-sm rounded border transition-colors ${
              direction === "encode"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input hover:bg-muted"
            }`}
          >
            {t("toolbox.encode")}
          </button>
          <button
            onClick={() => setDirection("decode")}
            className={`px-3 py-1 text-sm rounded border transition-colors ${
              direction === "decode"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input hover:bg-muted"
            }`}
          >
            {t("toolbox.decode")}
          </button>
        </div>

        <div>
          <label className="text-sm font-medium">
            {direction === "encode" ? t("toolbox.inputOriginal") : t("toolbox.inputBase64")}
          </label>
          <textarea
            className="w-full h-32 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={direction === "encode" ? "Hello World" : "SGVsbG8gV29ybGQ="}
          />
        </div>

        <div className="flex gap-2">
          <button onClick={handleConvert} className="btn-connect">
            {direction === "encode" ? t("toolbox.encode") : t("toolbox.decode")}
          </button>
          <button
            onClick={() => {
              setInput("");
              setOutput("");
            }}
            className="btn-secondary"
          >
            {t("toolbox.clear")}
          </button>
          <button
            onClick={() => {
              if (output) {
                navigator.clipboard.writeText(output);
                toast.success(t("toolbox.copied"));
              }
            }}
            className="btn-secondary flex items-center gap-1.5"
            disabled={!output}
          >
            <Copy className="w-3.5 h-3.5" />
            {t("toolbox.copyResult")}
          </button>
        </div>

        <div>
          <label className="text-sm font-medium">
            {direction === "encode" ? t("toolbox.outputBase64") : t("toolbox.outputOriginal")}
          </label>
          <textarea
            className="w-full h-32 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 focus:outline-none font-mono"
            value={output}
            readOnly
            placeholder={t("toolbox.resultHere")}
          />
        </div>
      </div>
    </ToolCard>
  );
};

// ==================== 工具3: 进制转换 ====================
const RadixConverter = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [fromBase, setFromBase] = useState<2 | 8 | 10 | 16>(10);
  const [results, setResults] = useState({ bin: "", oct: "", dec: "", hex: "" });

  const handleConvert = () => {
    try {
      if (!input.trim()) {
        setResults({ bin: "", oct: "", dec: "", hex: "" });
        return;
      }
      const decimal = parseInt(input.trim(), fromBase);
      if (isNaN(decimal)) throw new Error(t("toolbox.errorInvalidInput"));
      setResults({
        bin: decimal.toString(2),
        oct: decimal.toString(8),
        dec: decimal.toString(10),
        hex: decimal.toString(16).toUpperCase(),
      });
    } catch (e) {
      toast.error(`${t("toolbox.errorConversionFailed")}: ${(e as Error).message}`);
      setResults({ bin: "", oct: "", dec: "", hex: "" });
    }
  };

  return (
    <ToolCard title={t("toolbox.radixTitle")}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{t("toolbox.inputBase")}</label>
          <select
            className="h-8 px-2 text-sm rounded border border-input bg-background"
            value={fromBase}
            onChange={(e) => setFromBase(Number(e.target.value) as 2 | 8 | 10 | 16)}
          >
            <option value={2}>{t("toolbox.binary")}</option>
            <option value={8}>{t("toolbox.octal")}</option>
            <option value={10}>{t("toolbox.decimal")}</option>
            <option value={16}>{t("toolbox.hexadecimal")}</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">{t("toolbox.input")}</label>
          <input
            type="text"
            className="w-full h-10 mt-1.5 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              fromBase === 2
                ? "1010"
                : fromBase === 8
                ? "12"
                : fromBase === 10
                ? "10"
                : "A"
            }
          />
        </div>

        <div className="flex gap-2">
          <button onClick={handleConvert} className="btn-connect">
            {t("toolbox.convert")}
          </button>
          <button
            onClick={() => {
              setInput("");
              setResults({ bin: "", oct: "", dec: "", hex: "" });
            }}
            className="btn-secondary"
          >
            {t("toolbox.clear")}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ResultField label={t("toolbox.binary")} value={results.bin} />
          <ResultField label={t("toolbox.octal")} value={results.oct} />
          <ResultField label={t("toolbox.decimal")} value={results.dec} />
          <ResultField label={t("toolbox.hexadecimal")} value={results.hex} />
        </div>
      </div>
    </ToolCard>
  );
};

// ==================== 工具4: CRC/校验和计算 ====================
type ChecksumAlgorithm = "modbus" | "xmodem" | "checksum8" | "xor8" | "lrc";

const CrcCalculator = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [algorithm, setAlgorithm] = useState<ChecksumAlgorithm>("modbus");
  const [result, setResult] = useState("");

  const crc16Modbus = (data: Uint8Array): number => {
    let crc = 0xffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = crc & 0x0001 ? (crc >> 1) ^ 0xa001 : crc >> 1;
      }
    }
    return crc;
  };

  const crc16Xmodem = (data: Uint8Array): number => {
    let crc = 0x0000;
    for (const byte of data) {
      crc ^= byte << 8;
      for (let i = 0; i < 8; i++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      }
    }
    return crc & 0xffff;
  };

  const checksum8 = (data: Uint8Array): number => {
    let sum = 0;
    for (const byte of data) {
      sum += byte;
    }
    return sum & 0xff;
  };

  const xor8 = (data: Uint8Array): number => {
    let xor = 0;
    for (const byte of data) {
      xor ^= byte;
    }
    return xor;
  };

  const lrc = (data: Uint8Array): number => {
    let sum = 0;
    for (const byte of data) {
      sum += byte;
    }
    return ((~sum) + 1) & 0xff;
  };

  const handleCalculate = () => {
    try {
      if (!input.trim()) {
        setResult("");
        return;
      }
      const cleaned = input.replace(/[^0-9A-Fa-f]/g, "");
      if (cleaned.length % 2 !== 0) throw new Error(t("toolbox.errorHexEvenLength"));
      const bytes = new Uint8Array(
        cleaned.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []
      );

      let value: number;
      let padLength: number;

      switch (algorithm) {
        case "modbus":
          value = crc16Modbus(bytes);
          padLength = 4;
          break;
        case "xmodem":
          value = crc16Xmodem(bytes);
          padLength = 4;
          break;
        case "checksum8":
          value = checksum8(bytes);
          padLength = 2;
          break;
        case "xor8":
          value = xor8(bytes);
          padLength = 2;
          break;
        case "lrc":
          value = lrc(bytes);
          padLength = 2;
          break;
        default:
          throw new Error("Unknown algorithm");
      }

      setResult(value.toString(16).toUpperCase().padStart(padLength, "0"));
    } catch (e) {
      toast.error(`${t("toolbox.errorCalculationFailed")}: ${(e as Error).message}`);
      setResult("");
    }
  };

  return (
    <ToolCard title={t("toolbox.crcTitle")}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{t("toolbox.algorithm")}</label>
          <select
            className="h-8 px-2 text-sm rounded border border-input bg-background"
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value as ChecksumAlgorithm)}
          >
            <option value="modbus">CRC16-MODBUS</option>
            <option value="xmodem">CRC16-XMODEM</option>
            <option value="checksum8">Checksum8</option>
            <option value="xor8">XOR8</option>
            <option value="lrc">LRC</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">{t("toolbox.inputHex")}</label>
          <textarea
            className="w-full h-24 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="01 03 00 00 00 0A"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("toolbox.inputHexHint")}
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={handleCalculate} className="btn-connect">
            {t("toolbox.calculate")}
          </button>
          <button
            onClick={() => {
              setInput("");
              setResult("");
            }}
            className="btn-secondary"
          >
            {t("toolbox.clear")}
          </button>
          <button
            onClick={() => {
              if (result) {
                navigator.clipboard.writeText(result);
                toast.success(t("toolbox.copied"));
              }
            }}
            className="btn-secondary flex items-center gap-1.5"
            disabled={!result}
          >
            <Copy className="w-3.5 h-3.5" />
            {t("toolbox.copyResult")}
          </button>
        </div>

        <ResultField label={t("toolbox.checksumResult")} value={result} />
      </div>
    </ToolCard>
  );
};

// ==================== 工具5: 字节序转换 ====================
const EndianConverter = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [bitWidth, setBitWidth] = useState<16 | 32>(32);
  const [result, setResult] = useState("");

  const handleConvert = () => {
    try {
      if (!input.trim()) {
        setResult("");
        return;
      }
      const cleaned = input.replace(/[^0-9A-Fa-f]/g, "");
      const expectedLen = bitWidth === 16 ? 4 : 8;
      if (cleaned.length !== expectedLen) {
        throw new Error(
          t("toolbox.errorBitWidthRequirement", { bitWidth, count: expectedLen })
        );
      }
      const bytes = cleaned.match(/.{1,2}/g)?.reverse().join("") || "";
      setResult(bytes.toUpperCase());
    } catch (e) {
      toast.error(`${t("toolbox.errorConversionFailed")}: ${(e as Error).message}`);
      setResult("");
    }
  };

  return (
    <ToolCard title={t("toolbox.endianTitle")}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{t("toolbox.bitWidth")}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setBitWidth(16)}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                bitWidth === 16
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.bit16")}
            </button>
            <button
              onClick={() => setBitWidth(32)}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                bitWidth === 32
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.bit32")}
            </button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">{t("toolbox.inputHex")}</label>
          <input
            type="text"
            className="w-full h-10 mt-1.5 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={bitWidth === 16 ? "1234" : "12345678"}
            maxLength={bitWidth === 16 ? 4 : 8}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("toolbox.inputHexChars", { count: bitWidth === 16 ? 4 : 8 })}
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={handleConvert} className="btn-connect">
            {t("toolbox.convert")}
          </button>
          <button
            onClick={() => {
              setInput("");
              setResult("");
            }}
            className="btn-secondary"
          >
            {t("toolbox.clear")}
          </button>
          <button
            onClick={() => {
              if (result) {
                navigator.clipboard.writeText(result);
                toast.success(t("toolbox.copied"));
              }
            }}
            className="btn-secondary flex items-center gap-1.5"
            disabled={!result}
          >
            <Copy className="w-3.5 h-3.5" />
            {t("toolbox.copyResult")}
          </button>
        </div>

        <ResultField label={t("toolbox.convertResult")} value={result} />
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

const ResultField = ({ label, value }: { label: string; value: string }) => (
  <div>
    <label className="text-sm font-medium text-muted-foreground">{label}</label>
    <div className="mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 font-mono min-h-[40px] flex items-center">
      {value || <span className="text-muted-foreground">-</span>}
    </div>
  </div>
);
