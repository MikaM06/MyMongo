import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {useMemo} from 'react';
import {documentColumns, type WireDocument} from '../lib/wire';
import {BsonInline} from './bson-value';

export function ResultTable({
  documents,
  onSelect,
}: {
  documents: WireDocument[];
  onSelect?: (document: WireDocument) => void;
}) {
  const columns = useMemo<ColumnDef<WireDocument>[]>(
    () =>
      documentColumns(documents, 16).map(key => ({
        id: key,
        header: key,
        cell: ({row}) => {
          const value = row.original[key];
          return value === undefined ? (
            <span className="text-faint/60">—</span>
          ) : (
            <BsonInline value={value} max={60} />
          );
        },
      })),
    [documents],
  );
  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          {table.getHeaderGroups().map(group => (
            <tr key={group.id}>
              {group.headers.map(header => (
                <th
                  key={header.id}
                  className="border-b border-line bg-panel-2 px-3 py-2 text-left font-mono text-xs font-medium whitespace-nowrap text-muted first:pl-4"
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr
              key={row.id}
              onClick={() => onSelect?.(row.original)}
              className={
                onSelect ? 'cursor-pointer hover:bg-hover/70' : undefined
              }
            >
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  className="max-w-[320px] truncate border-b border-line px-3 py-[7px] first:pl-4"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
