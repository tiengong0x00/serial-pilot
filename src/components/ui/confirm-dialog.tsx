/**
 * 三选一确认对话框
 * 用于未保存修改的确认场景：保存/放弃/取消
 */

import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  onSave,
  onDiscard,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:justify-end">
          <button
            className="px-4 py-2 text-sm rounded-md border hover:bg-accent transition-colors"
            onClick={onCancel}
          >
            {t('confirm.cancel')}
          </button>
          <button
            className="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            onClick={onDiscard}
          >
            {t('confirm.discard')}
          </button>
          <button
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={onSave}
          >
            {t('confirm.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
