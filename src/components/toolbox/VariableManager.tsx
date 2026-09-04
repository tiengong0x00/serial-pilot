import { useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';

export default function VariableManager() {
  const { t } = useTranslation();
  const {
    globalVariables,
    addGlobalVariable,
    updateGlobalVariable,
    deleteGlobalVariable,
    toggleGlobalVariable,
  } = useSettingsStore();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleAdd = () => {
    if (newName.trim() && newValue.trim()) {
      addGlobalVariable(newName.trim(), newValue.trim());
      setNewName('');
      setNewValue('');
      setIsAdding(false);
    }
  };

  const handleUpdate = (id: string) => {
    if (newName.trim() && newValue.trim()) {
      updateGlobalVariable(id, newName.trim(), newValue.trim());
      setEditingId(null);
      setNewName('');
      setNewValue('');
    }
  };

  const handleStartEdit = (id: string, name: string, value: string) => {
    setEditingId(id);
    setNewName(name);
    setNewValue(value);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    setNewName('');
    setNewValue('');
  };

  const enabledCount = globalVariables.filter((v) => v.enabled).length;

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* 标题和添加按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('toolbox.variableManager.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('toolbox.variableManager.description')}
          </p>
        </div>
        {!isAdding && !editingId && (
          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            {t('toolbox.variableManager.addVariable')}
          </button>
        )}
      </div>

      {/* 变量列表 */}
      <div className="flex-1 overflow-y-auto border border-border rounded-md">
        <div className="divide-y divide-border">
          {/* 添加新变量行 */}
          {isAdding && (
            <div className="flex items-center gap-2 p-3 bg-muted/50">
              <input
                type="checkbox"
                checked={true}
                disabled
                className="w-4 h-4"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('toolbox.variableManager.namePlaceholder')}
                className="flex-1 px-2 py-1 border border-border rounded text-sm bg-background"
                autoFocus
              />
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={t('toolbox.variableManager.valuePlaceholder')}
                className="flex-[2] px-2 py-1 border border-border rounded text-sm bg-background"
              />
              <button
                onClick={handleAdd}
                className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-950 rounded"
                title={t('common.confirm')}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={handleCancelEdit}
                className="p-1 text-destructive hover:bg-destructive/10 rounded"
                title={t('common.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 变量列表 */}
          {globalVariables.map((variable) => (
            <div
              key={variable.id}
              className="flex items-center gap-2 p-3 hover:bg-muted/50 transition-colors"
            >
              {editingId === variable.id ? (
                <>
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="w-4 h-4"
                  />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('toolbox.variableManager.namePlaceholder')}
                    className="flex-1 px-2 py-1 border border-border rounded text-sm bg-background"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder={t('toolbox.variableManager.valuePlaceholder')}
                    className="flex-[2] px-2 py-1 border border-border rounded text-sm bg-background"
                  />
                  <button
                    onClick={() => handleUpdate(variable.id)}
                    className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-950 rounded"
                    title={t('common.confirm')}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1 text-destructive hover:bg-destructive/10 rounded"
                    title={t('common.cancel')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="checkbox"
                    checked={variable.enabled}
                    onChange={() => toggleGlobalVariable(variable.id)}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <div className="flex-1 font-mono text-sm font-medium">
                    {variable.name}
                  </div>
                  <div className="flex-[2] text-sm text-muted-foreground font-mono break-all">
                    {variable.value}
                  </div>
                  <button
                    onClick={() => handleStartEdit(variable.id, variable.name, variable.value)}
                    className="p-1 text-primary hover:bg-primary/10 rounded"
                    title={t('common.edit')}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteGlobalVariable(variable.id)}
                    className="p-1 text-destructive hover:bg-destructive/10 rounded"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ))}

          {/* 空状态 */}
          {globalVariables.length === 0 && !isAdding && (
            <div className="p-8 text-center text-muted-foreground">
              <p>{t('toolbox.variableManager.empty')}</p>
              <p className="text-sm mt-2">{t('toolbox.variableManager.emptyHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* 统计信息 */}
      <div className="text-sm text-muted-foreground">
        {t('toolbox.variableManager.enabledCount', { enabled: enabledCount, total: globalVariables.length })}
      </div>

      {/* 使用说明 */}
      <div className="border border-border rounded-md p-3 bg-muted/30">
        <h3 className="text-sm font-semibold mb-2">{t('toolbox.variableManager.usageTitle')}</h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• {t('toolbox.variableManager.usage1')}</li>
          <li>• {t('toolbox.variableManager.usage2')}</li>
          <li>• {t('toolbox.variableManager.usage3')}</li>
        </ul>
      </div>
    </div>
  );
}
