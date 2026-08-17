/**
 * 关键事件列表：测试执行的摘要视图
 * - 进度事件刷新（store 层已保证只有一条）
 * - 失败/守护/开始/完成事件按序展示
 * - 全部通过 i18n 渲染，支持中英文实时切换
 */
import { useTranslation } from "react-i18next";
import type { CriticalEvent } from "@/stores/executionStore";
import { formatDuration } from "@/hooks/useTestExecution";

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${time}.${ms}`;
}

interface Props {
  events: CriticalEvent[];
}

const CriticalEventList = ({ events }: Props) => {
  const { t } = useTranslation();

  if (events.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="border-l-2 border-border/50 pl-3">
          <EventRow event={event} t={t} />
        </div>
      ))}
    </div>
  );
};

// 单条事件渲染
const EventRow = ({
  event,
  t,
}: {
  event: CriticalEvent;
  t: ReturnType<typeof useTranslation>["t"];
}) => {
  const time = formatTime(event.timestamp);
  const timePrefix = <span className="text-muted-foreground">[{time}]</span>;

  // 开始事件
  if (event.type === "start" && event.start) {
    return (
      <div className="text-sm">
        {timePrefix}{" "}
        <span className="text-blue-600 dark:text-blue-400">🚀 {t("execution.eventStart")}</span>
        <div className="ml-6 mt-1 space-y-0.5 text-muted-foreground">
          <div>
            {t("execution.summaryRootCase")}: {event.start.rootCaseName}
          </div>
          <div>
            {t("execution.summaryTotalRounds", { count: event.start.totalRounds })}
          </div>
        </div>
      </div>
    );
  }

  // 进度事件（会被刷新）
  if (event.type === "progress" && event.progress) {
    const { completed, total, success, failure, remaining } = event.progress;
    const percent = Math.floor((completed / total) * 100);
    return (
      <div className="text-sm">
        {timePrefix}{" "}
        <span className="text-cyan-600 dark:text-cyan-400">
          📊 {t("execution.eventProgress", { completed, total, percent })}
        </span>
        <div className="ml-6 mt-1 space-y-0.5 text-xs text-muted-foreground">
          <div>├─ {t("execution.progressSuccess", { count: success })}</div>
          <div>├─ {t("execution.progressFailure", { count: failure })}</div>
          <div>└─ {t("execution.progressRemaining", { count: remaining })}</div>
        </div>
      </div>
    );
  }

  // 失败事件
  if (event.type === "failure" && event.failure) {
    const f = event.failure;
    return (
      <div className="text-sm">
        {timePrefix}{" "}
        <span className="text-red-600 dark:text-red-400">
          ❌ {t("execution.eventFailure", { round: f.roundIndex })}
        </span>
        <div className="ml-6 mt-1 space-y-0.5 text-xs text-muted-foreground">
          <div>
            {t("execution.failureRootCase")}: {f.rootTestCase.name}
          </div>
          {f.subTestCase && (
            <div>
              {t("execution.failureSubCase")}: {f.subTestCase.name}
            </div>
          )}
          {f.command && (
            <div>
              {t("execution.failureCommand")}: {f.command.name}
            </div>
          )}
          <div>
            {t("execution.failureReason")}: {f.reason}
          </div>
        </div>
      </div>
    );
  }

  // 守护触发事件
  if (event.type === "guard-trigger" && event.guardTrigger) {
    return (
      <div className="text-sm">
        {timePrefix}{" "}
        <span className="text-yellow-600 dark:text-yellow-400">
          ⚠️ {t("execution.eventGuardTriggered", { pattern: event.guardTrigger.pattern })}
        </span>
      </div>
    );
  }

  // 变量提取事件
  if (event.type === "variable-extracted" && event.variableExtracted) {
    const v = event.variableExtracted;
    return (
      <div className="text-sm">
        {timePrefix}{" "}
        <span className="text-purple-600 dark:text-purple-400">
          🔖 {t("execution.eventVariableExtracted", { variable: v.variable, value: v.value })}
        </span>
      </div>
    );
  }

  // 完成事件
  if (event.type === "complete" && event.summary) {
    const s = event.summary;
    const durationStr = formatDuration(s.duration);
    return (
      <div className="text-sm">
        {timePrefix}{" "}
        <span className="text-green-600 dark:text-green-400">
          ✅ {t("execution.eventComplete")}
        </span>
        <div className="ml-6 mt-1 space-y-1 text-xs">
          <div className="text-muted-foreground">
            {t("execution.summaryRootCase")}: {s.rootCaseName}
          </div>
          <div className="text-muted-foreground">
            ├─ {t("execution.summaryTotalRounds", { count: s.totalRounds })}
          </div>
          <div className="text-muted-foreground">
            ├─ {t("execution.summarySuccessRounds", { count: s.successCount })}
          </div>
          <div className="text-muted-foreground">
            ├─ {t("execution.summaryFailureRounds", { count: s.failureCount })}
          </div>
          <div className="text-muted-foreground">
            └─ {t("execution.summaryDuration", { duration: durationStr })}
          </div>

          {s.failureCount > 0 && (
            <>
              <div className="mt-2 font-medium text-red-600 dark:text-red-400">
                {t("execution.summaryFailureDetails")}
              </div>
              {s.failureList.map((fail, idx) => (
                <div key={idx} className="ml-2 text-muted-foreground">
                  - {t("execution.eventFailure", { round: fail.round })}{" "}
                  {fail.subCase && `[${fail.subCase} > `}
                  {fail.command ? `${fail.command}]` : fail.subCase ? "]" : `[${fail.rootCase}]`}: {fail.reason}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default CriticalEventList;
export { formatDuration };
