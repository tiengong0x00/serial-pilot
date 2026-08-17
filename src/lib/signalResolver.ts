import type { StandardCommand, PortLabel } from "@/types/testCase";

export type SignalLevel = boolean;
export type SignalControl = 'inherit' | 'high' | 'low';

/**
 * 解析命令在指定端口上的生效 DTR/RTS 电平
 *
 * 按发送口独立维护粘性状态：从初始值起，累积所有发送口相同的前序命令的 override
 *
 * @param commands 命令列表（已按执行顺序排列）
 * @param currentIndex 当前命令索引
 * @param resolveTxPort 解析命令实际发送口的函数（处理继承逻辑）
 * @param signal 'dtr' | 'rts'
 * @param initialLevels P1/P2 的初始电平 { P1: boolean, P2: boolean }
 * @returns 当前命令在其发送口上的生效电平
 */
export function resolveEffectiveSignal(
  commands: StandardCommand[],
  currentIndex: number,
  resolveTxPort: (cmd: StandardCommand) => PortLabel,
  signal: 'dtr' | 'rts',
  initialLevels: Record<PortLabel, SignalLevel>
): SignalLevel {
  const currentCmd = commands[currentIndex];
  const currentPort = resolveTxPort(currentCmd);

  // 从该端口的初始值开始
  let level = initialLevels[currentPort];

  // 累积当前命令之前、发送口相同的所有 override
  for (let i = 0; i < currentIndex; i++) {
    const cmd = commands[i];
    const cmdPort = resolveTxPort(cmd);
    if (cmdPort !== currentPort) continue;

    const control = cmd.advancedConfig?.[signal];
    if (control === 'high') level = true;
    else if (control === 'low') level = false;
    // 'inherit' 或 undefined：不改变
  }

  // 应用当前命令自己的 override
  const currentControl = currentCmd.advancedConfig?.[signal];
  if (currentControl === 'high') level = true;
  else if (currentControl === 'low') level = false;

  return level;
}
