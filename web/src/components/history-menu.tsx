import {History, Trash2} from 'lucide-react';
import {useState} from 'react';
import {clearHistory, type HistoryEntry, readHistory} from '../lib/history';
import {Button} from './ui/button';
import {Menu, MenuItem, MenuLabel, MenuSeparator} from './ui/dropdown';

function summary(entry: HistoryEntry): string {
  const text =
    entry.kind === 'aggregate'
      ? (entry.pipeline ?? '')
      : [entry.filter, entry.sort && `tri ${entry.sort}`]
          .filter(Boolean)
          .join(' · ') || '{}';
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat;
}

export function HistoryMenu({
  kind,
  namespace,
  onPick,
}: {
  kind: HistoryEntry['kind'];
  namespace: string;
  onPick: (entry: HistoryEntry) => void;
}) {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  return (
    <span
      onPointerDown={() =>
        setItems(readHistory().filter(item => item.kind === kind))
      }
      onKeyDown={() =>
        setItems(readHistory().filter(item => item.kind === kind))
      }
    >
      <Menu
        trigger={
          <Button
            variant="ghost"
            size="icon"
            title="Historique local des requêtes"
            aria-label="Historique des requêtes"
          >
            <History />
          </Button>
        }
      >
        <MenuLabel>Historique local</MenuLabel>
        {items.length ? (
          items.slice(0, 15).map(entry => (
            <MenuItem key={entry.id} onSelect={() => onPick(entry)}>
              <span className="block max-w-[380px] truncate font-mono text-xs">
                {summary(entry)}
              </span>
              <span
                className={
                  entry.namespace === namespace
                    ? 'block text-[11px] text-brand-ink'
                    : 'block text-[11px] text-faint'
                }
              >
                {entry.namespace} ·{' '}
                {new Date(entry.at).toLocaleString('fr-FR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </MenuItem>
          ))
        ) : (
          <p className="px-2.5 py-2 text-xs text-faint">
            Aucune requête enregistrée.
          </p>
        )}
        {items.length ? (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 />}
              danger
              onSelect={() => {
                clearHistory();
                setItems([]);
              }}
            >
              Effacer l’historique
            </MenuItem>
          </>
        ) : null}
      </Menu>
    </span>
  );
}
