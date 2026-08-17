import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Square, X, Copy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 自定义窗口控制按钮（缩小 / 最大化切换 / 关闭）
 *
 * 由于 tauri.conf.json 中 decorations 设为 false（隐藏原生标题栏），
 * 需在应用 Header 中自绘窗口按钮。窗口拖动由 Header 上的
 * data-tauri-drag-region 属性提供。
 */
const WindowControls = () => {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    // 初始化最大化状态并监听窗口尺寸变化
    void appWindow.isMaximized().then(setIsMaximized);
    void appWindow
      .onResized(async () => {
        setIsMaximized(await appWindow.isMaximized());
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => unlisten?.();
  }, []);

  const handleMinimize = () => void getCurrentWindow().minimize();
  const handleToggleMaximize = () => void getCurrentWindow().toggleMaximize();
  const handleClose = () => void getCurrentWindow().close();

  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-label={t('window.minimize')}
        className="h-8 w-10 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors rounded-md"
        onClick={handleMinimize}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
        className="h-8 w-10 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors rounded-md"
        onClick={handleToggleMaximize}
      >
        {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
      </button>
      <button
        type="button"
        aria-label={t('window.close')}
        className="h-8 w-10 inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors rounded-md"
        onClick={handleClose}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default WindowControls;
