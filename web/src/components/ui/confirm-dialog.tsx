import {AlertTriangle} from 'lucide-react';
import {type ReactNode, useEffect, useState} from 'react';
import {Button} from './button';
import {Modal} from './dialog';
import {Input} from './input';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  requireText,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  requireText?: string;
  onConfirm: (typed: string) => void;
  loading?: boolean;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) {
      setTyped('');
    }
  }, [open]);
  const ready = !requireText || typed === requireText;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={!ready}
            loading={loading}
            onClick={() => onConfirm(typed)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (ready) {
            onConfirm(typed);
          }
        }}
        className="space-y-4"
      >
        <div className="flex gap-3 rounded-md border border-danger/25 bg-danger-soft p-3 text-[13px] text-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="space-y-1">{children}</div>
        </div>
        {requireText ? (
          <div className="space-y-1.5">
            <label className="block text-xs text-muted" htmlFor="confirm-text">
              Pour confirmer, saisissez{' '}
              <code className="rounded bg-panel-2 px-1 py-0.5 font-mono text-text">
                {requireText}
              </code>
            </label>
            <Input
              id="confirm-text"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={event => setTyped(event.target.value)}
              className="font-mono"
            />
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
