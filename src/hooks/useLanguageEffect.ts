import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import i18n from "@/i18n";

/**
 * 语言副作用 Hook
 *
 * 监听 settingsStore.language 变化，同步到 i18next。
 * 挂载于 App 顶层，设置变更即时生效。
 */
export function useLanguageEffect() {
  const language = useSettingsStore((s) => s.language);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);
}
