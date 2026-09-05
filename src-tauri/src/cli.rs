use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};

#[derive(Parser, Debug, Clone)]
#[command(name = "serial-pilot")]
#[command(about = "Serial communication and testing tool", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,

    /// 显示窗口（调试用）
    #[arg(long, global = true)]
    pub show_window: bool,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Commands {
    /// 列出所有可用的串口
    ListPorts,

    /// 发送单条命令到串口
    Send {
        /// 要发送的命令内容
        command: String,

        /// 串口名称 (例如 COM1, /dev/ttyUSB0)
        #[arg(short, long)]
        port: String,

        /// 波特率
        #[arg(short, long, default_value = "115200")]
        baud: u32,

        /// 监听串口数据时长（毫秒）
        #[arg(short, long, default_value = "2000")]
        listen: u64,

        /// 数据格式 (text/hex)
        #[arg(short, long, default_value = "text")]
        format: String,

        /// 行结束符 (none/lf/cr/crlf)
        #[arg(short = 'e', long, default_value = "crlf")]
        line_ending: String,
    },

    /// 执行测试用例文件
    Run {
        /// 测试用例文件路径
        test_case: String,

        /// 串口名称（可选，优先使用此参数，否则使用测试用例中的配置）
        #[arg(short, long)]
        port: Option<String>,

        /// 波特率（可选，默认 115200）
        #[arg(short, long)]
        baud: Option<u32>,

        /// 输出结果到文件（可选，JSON 格式）
        #[arg(short, long)]
        output: Option<String>,

        /// 详细输出模式
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
