import {
  Braces,
  Copy,
  CopyPlus,
  Fingerprint,
  ListTree,
  Pencil,
  Trash2,
} from 'lucide-react';
import {useState} from 'react';
import {copyText} from '../lib/clipboard';
import {
  idDisplay,
  prettyJson,
  shellLiteral,
  type WireDocument,
} from '../lib/wire';
import {BsonTree} from './bson-value';
import {JsonView} from './json-view';
import {Button} from './ui/button';
import {Sheet} from './ui/dialog';
import {Segmented} from './ui/segmented';

export function DocumentPanel({
  document,
  onClose,
  canWrite,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  document: WireDocument | null;
  onClose: () => void;
  canWrite: boolean;
  onEdit: (document: WireDocument) => void;
  onDuplicate: (document: WireDocument) => void;
  onDelete: (document: WireDocument) => void;
}) {
  const [view, setView] = useState<'tree' | 'json'>('tree');
  return (
    <Sheet
      open={Boolean(document)}
      onOpenChange={open => !open && onClose()}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted">Document</span>
          <span className="truncate font-mono text-[12.5px] text-t-oid">
            {document ? idDisplay(document._id) : ''}
          </span>
        </span>
      }
    >
      {document ? (
        <div>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-line bg-panel px-4 py-2.5">
            <Segmented
              label="Affichage"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                {value: 'tree', label: 'Arbre', icon: <ListTree />},
                {value: 'json', label: 'JSON', icon: <Braces />},
              ]}
            />
            <div className="ml-auto flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void copyText(prettyJson(document), 'Document copié')
                }
              >
                <Copy />
                JSON
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void copyText(
                    document._id === undefined
                      ? ''
                      : shellLiteral(document._id),
                    '_id copié',
                  )
                }
              >
                <Fingerprint />
                _id
              </Button>
              {canWrite ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDuplicate(document)}
                  >
                    <CopyPlus />
                    Dupliquer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    onClick={() => onDelete(document)}
                  >
                    <Trash2 />
                    Supprimer
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onEdit(document)}
                  >
                    <Pencil />
                    Modifier
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <div className="px-3 py-2">
            {view === 'tree' ? (
              <BsonTree document={document} />
            ) : (
              <JsonView value={document} className="px-2 py-2" />
            )}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
