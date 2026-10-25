import {ChevronRight} from 'lucide-react';
import {useState} from 'react';
import {cn} from '../lib/cn';
import {
  type BsonKind,
  classify,
  isContainer,
  KIND_LABEL,
  type WireValue,
} from '../lib/wire';

const KIND_CLASS: Partial<Record<BsonKind, string>> = {
  string: 'text-t-string',
  int: 'text-t-number',
  double: 'text-t-number',
  long: 'text-t-number',
  decimal: 'text-t-number',
  bool: 'text-t-bool',
  null: 'text-t-null italic',
  objectId: 'text-t-oid',
  date: 'text-t-date',
  uuid: 'text-t-oid',
  binary: 'text-muted',
  regex: 'text-t-bool',
  timestamp: 'text-t-date',
  array: 'text-muted',
  object: 'text-muted',
};

const WRAPPED: Partial<Record<BsonKind, string>> = {
  objectId: 'ObjectId',
  date: 'ISODate',
  long: 'Long',
  decimal: 'Decimal',
  uuid: 'UUID',
};

export function BsonInline({
  value,
  max = 80,
}: {
  value: WireValue;
  max?: number;
}) {
  const {kind, text} = classify(value);
  const shown = text.length > max ? `${text.slice(0, max)}…` : text;
  if (kind === 'array' || kind === 'object') {
    const preview = JSON.stringify(value);
    return (
      <span className="text-muted" title={preview.slice(0, 2000)}>
        {kind === 'array' ? `[ ${(value as WireValue[]).length} ]` : text}
      </span>
    );
  }
  const wrapper = WRAPPED[kind];
  return (
    <span
      className={cn('font-mono', KIND_CLASS[kind])}
      title={`${KIND_LABEL[kind]} · ${text}`}
    >
      {wrapper ? <span className="text-faint">{wrapper}(</span> : null}
      {kind === 'string' ? `"${shown}"` : shown}
      {wrapper ? <span className="text-faint">)</span> : null}
    </span>
  );
}

export function TypeTag({value}: {value: WireValue}) {
  const {kind} = classify(value);
  return (
    <span className="rounded border border-line px-1 font-mono text-[10px] text-faint">
      {KIND_LABEL[kind]}
    </span>
  );
}

function TreeNode({
  name,
  value,
  depth,
}: {
  name: string;
  value: WireValue;
  depth: number;
}) {
  const container = isContainer(value);
  const [open, setOpen] = useState(depth < 2);
  const entries: [string, WireValue][] = container
    ? Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value as Record<string, WireValue>)
    : [];
  return (
    <div>
      <div
        className={cn(
          'group flex min-h-7 items-center gap-1.5 rounded-md pr-2 hover:bg-hover',
          container && 'cursor-pointer',
        )}
        style={{paddingLeft: depth * 16 + 4}}
        onClick={() => container && setOpen(!open)}
        onKeyDown={event => {
          if (container && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setOpen(!open);
          }
        }}
        role={container ? 'button' : undefined}
        tabIndex={container ? 0 : undefined}
        aria-expanded={container ? open : undefined}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-faint transition-transform',
            container ? '' : 'invisible',
            open && 'rotate-90',
          )}
        />
        <span className="font-mono text-[12.5px] text-t-key">{name}</span>
        <span className="text-faint">:</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          <BsonInline value={value} max={400} />
        </span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          <TypeTag value={value} />
        </span>
      </div>
      {container && open
        ? entries.map(([key, item]) => (
            <TreeNode key={key} name={key} value={item} depth={depth + 1} />
          ))
        : null}
    </div>
  );
}

export function BsonTree({document}: {document: Record<string, WireValue>}) {
  return (
    <div className="py-1">
      {Object.entries(document).map(([key, value]) => (
        <TreeNode key={key} name={key} value={value} depth={0} />
      ))}
    </div>
  );
}
