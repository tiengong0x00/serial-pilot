import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { CaseEditor } from './CaseEditor';
import type { TestCase } from '@/types/testCase';

interface CaseEditorDialogProps {
  open: boolean;
  case_: TestCase | null;
  onClose: () => void;
  onChange: (id: string, patch: Partial<TestCase>) => void;
}

export function CaseEditorDialog({ open, case_, onClose, onChange }: CaseEditorDialogProps) {
  const { t } = useTranslation();

  if (!case_) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 border-b">
          <DialogTitle>{t('testCase.editCaseProperties')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <CaseEditor case_={case_} onChange={(patch) => onChange(case_.id, patch)} />
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
