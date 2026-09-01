import { describe, it, expect } from "vitest";
import { resolveEffectiveSignal } from "@/lib/signalResolver";
import type { StandardCommand, PortLabel } from "@/types/testCase";

const makeCmd = (overrides: Partial<StandardCommand>): StandardCommand => ({
  id: Math.random().toString(36),
  type: "command",
  content: "AT",
  dataFormat: "utf8",
  lineEnding: "crlf",
  delay: 0,
  description: "",
  selected: true,
  status: "pending",
  repeatCount: 1,
  successThreshold: 1,
  stopWhenReached: false,
  timeout: 1000,
  validation: "none",
  onFailure: "continue",
  ...overrides,
});

describe("resolveEffectiveSignal", () => {
  const resolveTxPort = (cmd: StandardCommand): PortLabel => cmd.txPort ?? "P1";
  const initialLevels = { P1: true, P2: true };

  it("无 override 时返回初始值", () => {
    const cmds = [makeCmd({})];
    expect(resolveEffectiveSignal(cmds, 0, resolveTxPort, "dtr", initialLevels)).toBe(true);
  });

  it("inherit 不改变电平", () => {
    const cmds = [makeCmd({ advancedConfig: { dtr: "inherit" } })];
    expect(resolveEffectiveSignal(cmds, 0, resolveTxPort, "dtr", initialLevels)).toBe(true);
  });

  it("当前命令设为 low", () => {
    const cmds = [makeCmd({ advancedConfig: { dtr: "low" } })];
    expect(resolveEffectiveSignal(cmds, 0, resolveTxPort, "dtr", initialLevels)).toBe(false);
  });

  it("前序命令改变，当前继承", () => {
    const cmds = [
      makeCmd({ advancedConfig: { dtr: "low" } }),
      makeCmd({}),
    ];
    expect(resolveEffectiveSignal(cmds, 1, resolveTxPort, "dtr", initialLevels)).toBe(false);
  });

  it("P1/P2 状态独立", () => {
    const cmds = [
      makeCmd({ txPort: "P1", advancedConfig: { dtr: "low" } }),
      makeCmd({ txPort: "P2" }),
    ];
    expect(resolveEffectiveSignal(cmds, 1, resolveTxPort, "dtr", initialLevels)).toBe(true);
  });

  it("累积多个 override", () => {
    const cmds = [
      makeCmd({ advancedConfig: { dtr: "low" } }),
      makeCmd({ advancedConfig: { dtr: "high" } }),
      makeCmd({}),
    ];
    expect(resolveEffectiveSignal(cmds, 2, resolveTxPort, "dtr", initialLevels)).toBe(true);
  });

  it("跨端口不累积", () => {
    const cmds = [
      makeCmd({ txPort: "P1", advancedConfig: { dtr: "low" } }),
      makeCmd({ txPort: "P2", advancedConfig: { dtr: "low" } }),
      makeCmd({ txPort: "P1" }),
    ];
    expect(resolveEffectiveSignal(cmds, 2, resolveTxPort, "dtr", initialLevels)).toBe(false);
  });

  it("只累积同端口的", () => {
    const cmds = [
      makeCmd({ txPort: "P1", advancedConfig: { rts: "low" } }),
      makeCmd({ txPort: "P2", advancedConfig: { rts: "high" } }),
      makeCmd({ txPort: "P1", advancedConfig: { rts: "high" } }),
      makeCmd({ txPort: "P1" }),
    ];
    expect(resolveEffectiveSignal(cmds, 3, resolveTxPort, "rts", { P1: false, P2: false })).toBe(true);
  });
});
