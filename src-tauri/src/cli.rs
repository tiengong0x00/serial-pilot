use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};

#[derive(Parser, Debug, Clone)]
#[command(name = "serial-pilot")]
#[command(about = "串口通信与测试工具（命令行模式）")]
#[command(long_about = "Serial Pilot 命令行模式：无需图形界面即可列出串口、发送命令、执行测试用例。\n\n\
提示：\n\
  • 每个子命令都有独立帮助，用 `serial-pilot <命令> --help` 查看该命令的全部选项与示例。\n\
  • 大多数选项都有简写与长写两种形式（如 -p / --port），可混用。\n\
  • 不带任何命令直接运行则启动图形界面。")]
#[command(after_help = "常见用法示例：\n  \
# 列出所有可用串口\n  \
serial-pilot list-ports\n\n  \
# 向 COM3 发送 AT 命令并监听 3 秒响应\n  \
serial-pilot send \"AT\" --port COM3 --listen 3000\n\n  \
# 指定波特率、十六进制格式、无行结束符发送\n  \
serial-pilot send \"01 03 00\" -p COM3 -b 9600 --format hex --line-ending none\n\n  \
# 执行测试用例文件，覆盖端口与波特率，结果写入 JSON\n  \
serial-pilot run mytest.json --port COM3 --baud 115200 --output result.json --verbose\n\n\
查看某个子命令的完整帮助：\n  \
serial-pilot send --help\n  \
serial-pilot run --help")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,

    /// 显示窗口（调试用）。CLI 模式默认全程隐藏窗口，加此项可显示以便观察 UI
    #[arg(long, global = true)]
    pub show_window: bool,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Commands {
    /// 列出所有可用的串口
    #[command(long_about = "列出系统当前所有可用串口及其名称。\n\n\
用于确认设备对应的端口号（Windows 如 COM3，Linux 如 /dev/ttyUSB0），再传给 send / run。")]
    #[command(after_help = "示例：\n  serial-pilot list-ports")]
    ListPorts,

    /// 发送单条命令到串口并监听响应
    #[command(long_about = "连接指定串口，发送一条命令，并在给定时长内监听并打印返回数据。\n\n\
适合快速验证设备是否响应，或手动调试单条指令。")]
    #[command(after_help = "示例：\n  \
# 最简：默认 115200 波特率、crlf 结束符、监听 2 秒\n  \
serial-pilot send \"AT\" --port COM3\n\n  \
# 监听 5 秒，指定波特率\n  \
serial-pilot send \"ATI\" -p COM3 -b 9600 --listen 5000\n\n  \
# 十六进制发送、不追加行结束符\n  \
serial-pilot send \"01 03 00 00 00 01\" -p COM3 --format hex --line-ending none")]
    Send {
        /// 要发送的命令内容（text 格式为原文；hex 格式为空格分隔的十六进制字节，如 "01 03 A0"）
        command: String,

        /// 串口名称 (例如 COM1, /dev/ttyUSB0)
        #[arg(short, long)]
        port: String,

        /// 波特率（常见值：9600 / 19200 / 38400 / 57600 / 115200）
        #[arg(short, long, default_value = "115200")]
        baud: u32,

        /// 发送后监听返回数据的时长（毫秒）。设备响应较慢时可调大
        #[arg(short, long, default_value = "2000")]
        listen: u64,

        /// 数据格式：text=按文本发送 / hex=按十六进制字节发送
        #[arg(short, long, default_value = "text", value_parser = ["text", "hex"])]
        format: String,

        /// 行结束符：none=不追加 / lf=\n / cr=\r / crlf=\r\n
        #[arg(short = 'e', long, default_value = "crlf", value_parser = ["none", "lf", "cr", "crlf"])]
        line_ending: String,
    },

    /// 执行测试用例文件
    #[command(long_about = "加载并执行一个测试用例 JSON 文件，逐条运行其中命令并按用例定义校验响应。\n\n\
文件路径支持相对当前目录或绝对路径；相对路径找不到时会回退到内置测试用例目录。\n\
可用 --port / --baud 覆盖用例内的串口配置，用 --output 把结果保存为 JSON。")]
    #[command(after_help = "示例：\n  \
# 用文件内配置执行\n  \
serial-pilot run mytest.json\n\n  \
# 覆盖端口与波特率\n  \
serial-pilot run mytest.json --port COM3 --baud 115200\n\n  \
# 详细输出并保存结果\n  \
serial-pilot run mytest.json -p COM3 --verbose --output result.json")]
    Run {
        /// 测试用例文件路径（相对当前目录或绝对路径；相对路径未命中时回退到内置用例目录）
        test_case: String,

        /// 串口名称（可选，优先使用此参数，否则使用测试用例中的配置）
        #[arg(short, long)]
        port: Option<String>,

        /// 波特率（可选，默认 115200；不指定则用测试用例中的配置）
        #[arg(short, long)]
        baud: Option<u32>,

        /// 输出结果到文件（可选，JSON 格式）
        #[arg(short, long)]
        output: Option<String>,

        /// 详细输出模式：打印每条命令的发送/接收/校验细节
        #[arg(short, long)]
        verbose: bool,
    },
}

// CLI 事件数据结构

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalData {
    pub timestamp: u64,
    pub port: String,
    pub direction: String,
    pub data: Vec<u8>,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionLog {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCompleteResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_commands: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success_commands: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_commands: Option<u32>,
}
