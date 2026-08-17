import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// 随机字符串生成最大长度（嵌入式 AT 通讯可能需要几 K）
const MAX_RANDOM_LENGTH = 65536;

const StringTools = () => {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<string>("byte-counter");

  const tools = [
    { id: "byte-counter", label: t("toolbox.toolByteCounter") },
    { id: "random-string", label: t("toolbox.toolRandomString") },
    { id: "timestamp", label: t("toolbox.toolTimestamp") },
    { id: "regex-tester", label: t("toolbox.toolRegexTester") },
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
        {activeTool === "byte-counter" && <ByteCounter />}
        {activeTool === "random-string" && <RandomStringGenerator />}
        {activeTool === "timestamp" && <TimestampConverter />}
        {activeTool === "regex-tester" && <RegexTester />}
      </div>
    </div>
  );
};

export default StringTools;

// ==================== 工具1: 字节长度统计 ====================
const ByteCounter = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [stats, setStats] = useState({
    utf8: 0,
    utf8Chars: 0,
    ascii: 0,
    gbk: 0,
  });

  const updateStats = (text: string) => {
    const utf8Bytes = new TextEncoder().encode(text).length;
    const utf8Chars = Array.from(text).length;
    // ASCII: 只计算 0-127 范围字符，其他按1字节
    const asciiBytes = Array.from(text).reduce(
      (sum, char) => sum + (char.charCodeAt(0) <= 127 ? 1 : 1),
      0
    );
    // GBK 估算：中文2字节，ASCII 1字节
    const gbkBytes = Array.from(text).reduce(
      (sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1),
      0
    );

    setStats({
      utf8: utf8Bytes,
      utf8Chars,
      ascii: asciiBytes,
      gbk: gbkBytes,
    });
  };

  const handleInputChange = (text: string) => {
    setInput(text);
    updateStats(text);
  };

  return (
    <ToolCard title={t("toolbox.byteCounterTitle")}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t("toolbox.inputText")}</label>
          <textarea
            className="w-full h-40 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={t("toolbox.inputTextPlaceholder")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label={t("toolbox.utf8Bytes")} value={stats.utf8} />
          <StatCard label={t("toolbox.utf8Chars")} value={stats.utf8Chars} />
          <StatCard label={t("toolbox.asciiBytes")} value={stats.ascii} hint={t("toolbox.asciiBytesHint")} />
          <StatCard label={t("toolbox.gbkBytes")} value={stats.gbk} hint={t("toolbox.gbkBytesHint")} />
        </div>

        <button
          onClick={() => {
            setInput("");
            setStats({ utf8: 0, utf8Chars: 0, ascii: 0, gbk: 0 });
          }}
          className="btn-secondary"
        >
          {t("toolbox.clear")}
        </button>
      </div>
    </ToolCard>
  );
};

// ==================== 工具2: 随机字符串生成 ====================
const RandomStringGenerator = () => {
  const { t } = useTranslation();
  const [length, setLength] = useState(16);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeLetters, setIncludeLetters] = useState(true);
  const [includeUppercase, setIncludeUppercase] = useState(true);
  const [includeLowercase, setIncludeLowercase] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(false);
  const [result, setResult] = useState("");

  const generate = () => {
    let charset = "";
    if (includeNumbers) charset += "0123456789";
    if (includeLetters && includeUppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (includeLetters && includeLowercase) charset += "abcdefghijklmnopqrstuvwxyz";
    if (includeSymbols) charset += "!@#$%^&*()_+-=[]{}|;:,.<>?";

    if (charset.length === 0) {
      toast.error(t("toolbox.atLeastOneType"));
      return;
    }

    // 大长度（几万字符）时用数组预分配 + join，避免字符串反复拼接的性能问题
    const chars = new Array<string>(length);
    const charsetLen = charset.length;
    for (let i = 0; i < length; i++) {
      chars[i] = charset.charAt(Math.floor(Math.random() * charsetLen));
    }

    setResult(chars.join(""));
  };

  return (
    <ToolCard title={t("toolbox.randomStringTitle")}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t("toolbox.length")}</label>
          <input
            type="number"
            min={1}
            max={MAX_RANDOM_LENGTH}
            value={length}
            onChange={(e) =>
              setLength(
                Math.max(1, Math.min(MAX_RANDOM_LENGTH, Math.floor(Number(e.target.value)) || 1))
              )
            }
            className="w-full h-10 mt-1.5 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("toolbox.lengthHint", { max: MAX_RANDOM_LENGTH })}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t("toolbox.charTypes")}</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeNumbers}
                onChange={(e) => setIncludeNumbers(e.target.checked)}
                className="rounded border-input"
              />
              {t("toolbox.numbers")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeLetters}
                onChange={(e) => {
                  setIncludeLetters(e.target.checked);
                  if (!e.target.checked) {
                    setIncludeUppercase(false);
                    setIncludeLowercase(false);
                  }
                }}
                className="rounded border-input"
              />
              {t("toolbox.letters")}
            </label>
            {includeLetters && (
              <div className="ml-6 space-y-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeUppercase}
                    onChange={(e) => setIncludeUppercase(e.target.checked)}
                    className="rounded border-input"
                  />
                  {t("toolbox.uppercase")}
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={includeLowercase}
                    onChange={(e) => setIncludeLowercase(e.target.checked)}
                    className="rounded border-input"
                  />
                  {t("toolbox.lowercase")}
                </label>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSymbols}
                onChange={(e) => setIncludeSymbols(e.target.checked)}
                className="rounded border-input"
              />
              {t("toolbox.symbols")}
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={generate} className="btn-connect flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            {t("toolbox.generate")}
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
            {t("toolbox.copy")}
          </button>
        </div>

        {result && (
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">{t("toolbox.generatedResult")}</label>
              <span className="text-xs text-muted-foreground font-mono">
                {t("toolbox.actualLength", { count: result.length })}
              </span>
            </div>
            <textarea
              readOnly
              value={result}
              className="w-full h-40 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 font-mono break-all resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
      </div>
    </ToolCard>
  );
};

// ==================== 工具3: 时间戳转换 ====================
const TimestampConverter = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [unit, setUnit] = useState<"ms" | "s">("ms");
  const [result, setResult] = useState({
    iso: "",
    local: "",
    utc: "",
  });

  const handleConvert = () => {
    try {
      if (!input.trim()) {
        setResult({ iso: "", local: "", utc: "" });
        return;
      }
      const timestamp = Number(input);
      if (isNaN(timestamp)) throw new Error(t("toolbox.errorInvalidTimestamp"));

      const date = new Date(unit === "ms" ? timestamp : timestamp * 1000);
      if (isNaN(date.getTime())) throw new Error(t("toolbox.errorTimestampOutOfRange"));

      setResult({
        iso: date.toISOString(),
        local: date.toLocaleString(undefined, { hour12: false }),
        utc: date.toUTCString(),
      });
    } catch (e) {
      toast.error(`${t("toolbox.errorConversionFailed")}: ${(e as Error).message}`);
      setResult({ iso: "", local: "", utc: "" });
    }
  };

  const handleCurrentTime = () => {
    const now = Date.now();
    setInput(String(unit === "ms" ? now : Math.floor(now / 1000)));
    setUnit("ms");
    const date = new Date(now);
    setResult({
      iso: date.toISOString(),
      local: date.toLocaleString(undefined, { hour12: false }),
      utc: date.toUTCString(),
    });
  };

  const handleReverseConvert = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) throw new Error(t("toolbox.errorInvalidDateFormat"));
      const timestamp = date.getTime();
      setInput(String(unit === "ms" ? timestamp : Math.floor(timestamp / 1000)));
    } catch (e) {
      toast.error(`${t("toolbox.errorConversionFailed")}: ${(e as Error).message}`);
    }
  };

  return (
    <ToolCard title={t("toolbox.timestampTitle")}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{t("toolbox.unit")}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setUnit("ms")}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                unit === "ms"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.milliseconds")}
            </button>
            <button
              onClick={() => setUnit("s")}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                unit === "s"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.seconds")}
            </button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">{t("toolbox.timestamp")}</label>
          <input
            type="text"
            className="w-full h-10 mt-1.5 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={unit === "ms" ? "1704067200000" : "1704067200"}
          />
        </div>

        <div className="flex gap-2">
          <button onClick={handleConvert} className="btn-connect">
            {t("toolbox.convert")}
          </button>
          <button onClick={handleCurrentTime} className="btn-secondary">
            {t("toolbox.currentTime")}
          </button>
          <button
            onClick={() => {
              setInput("");
              setResult({ iso: "", local: "", utc: "" });
            }}
            className="btn-secondary"
          >
            {t("toolbox.clear")}
          </button>
        </div>

        {(result.iso || result.local || result.utc) && (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  ISO8601
                </label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.iso);
                    toast.success(t("toolbox.copied"));
                  }}
                  className="p-1 hover:bg-muted rounded"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              <div className="mt-1 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 font-mono">
                {result.iso}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  {t("toolbox.localTime")}
                </label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.local);
                    toast.success(t("toolbox.copied"));
                  }}
                  className="p-1 hover:bg-muted rounded"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              <div className="mt-1 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 font-mono">
                {result.local}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  UTC
                </label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.utc);
                    toast.success(t("toolbox.copied"));
                  }}
                  className="p-1 hover:bg-muted rounded"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              <div className="mt-1 px-3 py-2 text-sm rounded-md border border-input bg-muted/50 font-mono">
                {result.utc}
              </div>
            </div>

            <div className="pt-2 border-t">
              <label className="text-sm font-medium text-muted-foreground">
                {t("toolbox.reverseConvert")}
              </label>
              <div className="flex gap-2 mt-1.5">
                <input
                  type="text"
                  className="flex-1 h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={t("toolbox.reverseConvertPlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleReverseConvert(e.currentTarget.value);
                    }
                  }}
                />
                <button
                  onClick={(e) => {
                    const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                    handleReverseConvert(input.value);
                  }}
                  className="btn-secondary"
                >
                  {t("toolbox.convert")}
                </button>
              </div>
            </div>
          </div>
        )}
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

const StatCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) => (
  <div className="p-3 rounded-md border border-input bg-muted/30">
    <div className="text-xs text-muted-foreground mb-1">
      {label}
      {hint && <span className="ml-1">({hint})</span>}
    </div>
    <div className="text-2xl font-semibold font-mono">{value}</div>
  </div>
);

// ==================== 工具4: 正则表达式测试 ====================
const RegexTester = () => {
  const { t } = useTranslation();
  const [inputMode, setInputMode] = useState<"text" | "hex">("text");
  const [inputText, setInputText] = useState("");
  const [inputHex, setInputHex] = useState("");
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState({ g: true, i: false, m: false, s: false });
  const [matches, setMatches] = useState<RegExpExecArray[]>([]);
  const [error, setError] = useState("");

  // 预置正则库
  const presets = [
    { key: "csq", label: t("toolbox.regexPresetCsq"), pattern: "\\+CSQ:\\s*(\\d+),(\\d+)" },
    { key: "creg", label: t("toolbox.regexPresetCreg"), pattern: "\\+CREG:\\s*(\\d+),(\\d+)" },
    { key: "cgatt", label: t("toolbox.regexPresetCgatt"), pattern: "\\+CGATT:\\s*(\\d+)" },
    { key: "ok-error", label: t("toolbox.regexPresetOkError"), pattern: "(OK|ERROR)\\s*$" },
    { key: "cme-error", label: t("toolbox.regexPresetCmeError"), pattern: "\\+CME ERROR:\\s*(\\d+)" },
    { key: "ipv4", label: t("toolbox.regexPresetIpv4"), pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b" },
    { key: "mac", label: t("toolbox.regexPresetMac"), pattern: "(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}" },
    { key: "imei", label: t("toolbox.regexPresetImei"), pattern: "\\b\\d{15}\\b" },
    { key: "iccid", label: t("toolbox.regexPresetCcid"), pattern: "\\b\\d{19,20}\\b" },
    { key: "hex-bytes", label: t("toolbox.regexPresetHexBytes"), pattern: "(?:[0-9A-Fa-f]{2}\\s*)+" },
    { key: "urc", label: t("toolbox.regexPresetUrc"), pattern: "\\+([A-Z]+):\\s*(.+)" },
    { key: "number", label: t("toolbox.regexPresetNumber"), pattern: "-?\\d+(?:\\.\\d+)?" },
  ];

  const handleTest = () => {
    setError("");
    setMatches([]);

    if (!pattern.trim()) {
      setError(t("toolbox.regexEmptyPattern"));
      return;
    }

    // 获取输入文本
    let text = "";
    if (inputMode === "text") {
      text = inputText;
    } else {
      // HEX 模式：解析 HEX 并转为字符串（Latin-1）
      try {
        const hex = inputHex.replace(/\s+/g, "");
        if (!/^[0-9A-Fa-f]*$/.test(hex)) {
          setError(t("toolbox.regexInvalidHex"));
          return;
        }
        if (hex.length % 2 !== 0) {
          setError(t("toolbox.errorHexEvenLength"));
          return;
        }
        const bytes: number[] = [];
        for (let i = 0; i < hex.length; i += 2) {
          bytes.push(parseInt(hex.substr(i, 2), 16));
        }
        // Latin-1 解码（直接映射字节到字符码点）
        text = String.fromCharCode(...bytes);
      } catch (e) {
        setError(t("toolbox.regexInvalidHex"));
        return;
      }
    }

    // 构造正则
    try {
      const flagStr = Object.entries(flags)
        .filter(([_, v]) => v)
        .map(([k, _]) => k)
        .join("");
      const regex = new RegExp(pattern, flagStr);

      const results: RegExpExecArray[] = [];
      if (flags.g) {
        // 全局模式：循环匹配
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          results.push(match);
          // 防止空匹配无限循环
          if (match.index === regex.lastIndex) {
            regex.lastIndex++;
          }
        }
      } else {
        // 非全局：只匹配一次
        const match = regex.exec(text);
        if (match) results.push(match);
      }

      setMatches(results);
    } catch (e) {
      setError(`${t("toolbox.regexInvalidPattern")}: ${(e as Error).message}`);
    }
  };

  const handlePresetSelect = (presetPattern: string) => {
    setPattern(presetPattern);
  };

  return (
    <ToolCard title={t("toolbox.regexTesterTitle")}>
      <div className="space-y-4">
        {/* 输入模式切换 */}
        <div>
          <label className="text-sm font-medium">{t("toolbox.regexInputMode")}</label>
          <div className="flex gap-2 mt-1.5">
            <button
              onClick={() => setInputMode("text")}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                inputMode === "text"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.regexModeText")}
            </button>
            <button
              onClick={() => setInputMode("hex")}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                inputMode === "hex"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              {t("toolbox.regexModeHex")}
            </button>
          </div>
        </div>

        {/* 输入框 */}
        <div>
          <label className="text-sm font-medium">{t("toolbox.input")}</label>
          {inputMode === "text" ? (
            <textarea
              className="w-full h-32 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t("toolbox.regexInputTextHint")}
            />
          ) : (
            <textarea
              className="w-full h-32 mt-1.5 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              value={inputHex}
              onChange={(e) => setInputHex(e.target.value)}
              placeholder={t("toolbox.regexInputHexHint")}
            />
          )}
        </div>

        {/* 预置正则库 */}
        <div>
          <label className="text-sm font-medium">{t("toolbox.regexPresets")}</label>
          <select
            className="w-full h-9 mt-1.5 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            onChange={(e) => {
              const preset = presets.find((p) => p.key === e.target.value);
              if (preset) handlePresetSelect(preset.pattern);
            }}
            value=""
          >
            <option value="">{t("toolbox.regexPresetSelect")}</option>
            {presets.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        {/* 正则表达式 */}
        <div>
          <label className="text-sm font-medium">{t("toolbox.regexPattern")}</label>
          <input
            type="text"
            className="w-full h-10 mt-1.5 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t("toolbox.regexPatternPlaceholder")}
          />
        </div>

        {/* 标志 */}
        <div>
          <label className="text-sm font-medium">{t("toolbox.regexFlags")}</label>
          <div className="flex gap-3 mt-1.5">
            {(["g", "i", "m", "s"] as const).map((flag) => (
              <label key={flag} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={flags[flag]}
                  onChange={(e) => setFlags({ ...flags, [flag]: e.target.checked })}
                  className="rounded border-input"
                />
                {t(`toolbox.regexFlag${flag.toUpperCase()}`)}
              </label>
            ))}
          </div>
        </div>

        {/* 测试按钮 */}
        <div className="flex gap-2">
          <button onClick={handleTest} className="btn-connect">
            {t("toolbox.convert")}
          </button>
          <button
            onClick={() => {
              setInputText("");
              setInputHex("");
              setPattern("");
              setMatches([]);
              setError("");
            }}
            className="btn-secondary"
          >
            {t("toolbox.clear")}
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* 匹配结果 */}
        {!error && matches.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-green-600 dark:text-green-400">
                {t("toolbox.regexMatched")}
              </label>
              <span className="text-xs text-muted-foreground">
                {t("toolbox.regexMatchCount", { count: matches.length })}
              </span>
            </div>

            {matches.map((match, idx) => (
              <div key={idx} className="p-3 rounded-md border border-input bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("toolbox.regexMatchIndex")}: {match.index}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(match[0]);
                      toast.success(t("toolbox.copied"));
                    }}
                    className="p-1 hover:bg-muted rounded"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("toolbox.regexFullMatch")}:
                  </div>
                  <div className="px-2 py-1.5 rounded bg-background border border-input font-mono text-sm break-all">
                    {match[0]}
                  </div>
                </div>

                {match.length > 1 && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1.5">
                      {t("toolbox.regexGroups")}:
                    </div>
                    <div className="space-y-1.5">
                      {match.slice(1).map((group, gIdx) => (
                        <div key={gIdx} className="flex items-start gap-2">
                          <span className="text-xs text-muted-foreground min-w-[4rem]">
                            {t("toolbox.regexGroupIndex", { index: gIdx + 1 })}:
                          </span>
                          <div className="flex-1 px-2 py-1 rounded bg-background border border-input font-mono text-xs break-all">
                            {group ?? "(undefined)"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!error && matches.length === 0 && pattern && (
          <div className="p-3 rounded-md bg-muted/50 border border-input">
            <p className="text-sm text-muted-foreground">{t("toolbox.regexNoMatch")}</p>
          </div>
        )}
      </div>
    </ToolCard>
  );
};
