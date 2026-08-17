import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { CommandEditor } from './CommandEditor';
import type { TestCommand } from '@/types/testCase';

interface CommandEditorDialogProps {
  open: boolean;
  command: TestCommand | null;
  caseId: string | null;
  onClose: () => void;
  onChange: (caseId: string, cmdId: string, patch: Partial<TestCommand>) => void;
}

export function CommandEditorDialog({
  open,
  command,
  caseId,
  onClose,
  onChange,
}: CommandEditorDialogProps) {
  const { t } = useTranslation();

  if (!command || !caseId) return null;

  const getTypeLabel = (type: TestCommand['type']) => {
    switch (type) {
      case 'command':
        return t('testCase.typeCommandPlain');
      case 'urc-guard':
        return t('testCase.typeUrcGuard');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 border-b">
          <DialogTitle>{t('testCase.editCommandTitle', { type: getTypeLabel(command.type) })}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <CommandEditor
            command={command}
            onChange={(patch) => onChange(caseId, command.id, patch)}
          />
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <DialogClose asChild>
            <button className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
              {t('testCase.done')}
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
