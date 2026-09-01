import { useState } from "react";
import { Calculator, Type, Network, Cpu, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import WindowControls from "@/components/WindowControls";

// 工具分类
type ToolCategory = "conversion" | "string" | "network" | "embedded" | "command-lib";

// 导入各分类工具
import ConversionTools from "./ConversionTools";
import StringTools from "./StringTools";
import EmbeddedTools from "./EmbeddedTools";
import NetworkTools from "./NetworkTools";
import CommandLibraryManager from "./CommandLibraryManager";

const ToolboxWindow = () => {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<ToolCategory>("conversion");

  const categories = [
    { id: "conversion" as const, label: t("toolbox.categoryConversion"), icon: Calculator },
    { id: "string" as const, label: t("toolbox.categoryString"), icon: Type },
    { id: "network" as const, label: t("toolbox.categoryNetwork"), icon: Network },
    { id: "embedded" as const, label: t("toolbox.categoryEmbedded"), icon: Cpu },
    { id: "command-lib" as const, label: t("toolbox.categoryCommandLib"), icon: Database },
  ];

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* 标题栏 */}
      <div className="h-12 flex items-center justify-between px-4 border-b bg-card" data-tauri-drag-region>
        <h1 className="text-sm font-semibold">{t("toolbox.title")}</h1>
        <WindowControls />
      </div>

      {/* 主体区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航（仅图标） */}
        <nav className="w-14 border-r bg-muted/30 flex flex-col">
          {categories.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                title={cat.label}
                aria-label={cat.label}
                className={`
                  w-full py-4 flex items-center justify-center transition-colors
                  ${
                    activeCategory === cat.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent text-muted-foreground hover:text-foreground"
                  }
                `}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </nav>

        {/* 右侧内容区 */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {activeCategory === "conversion" && <ConversionTools />}
          {activeCategory === "string" && <StringTools />}
          {activeCategory === "network" && <NetworkTools />}
          {activeCategory === "embedded" && <EmbeddedTools />}
          {activeCategory === "command-lib" && <CommandLibraryManager />}
        </div>
      </div>
    </div>
  );
};

export default ToolboxWindow;
