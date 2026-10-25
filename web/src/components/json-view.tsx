import {Fragment, useMemo} from 'react';
import {cn} from '../lib/cn';

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;

function highlight(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push(text.slice(last, start));
    }
    const [whole, string, colon, bool, number, punct] = match;
    let className = 'text-t-null';
    if (string !== undefined) {
      if (colon) {
        const isType = /^"\$[a-zA-Z]+"$/.test(string);
        parts.push(
          <Fragment key={index++}>
            <span className={isType ? 'text-t-oid' : 'text-t-key'}>
              {string}
            </span>
            <span className="text-faint">{colon}</span>
          </Fragment>,
        );
        last = start + whole.length;
        continue;
      }
      className = 'text-t-string';
    } else if (bool !== undefined) {
      className = 'text-t-bool';
    } else if (number !== undefined) {
      className = 'text-t-number';
    } else if (punct !== undefined) {
      className = 'text-faint';
    }
    parts.push(
      <span key={index++} className={className}>
        {whole}
      </span>,
    );
    last = start + whole.length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

export function JsonView({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const content = useMemo(
    () => highlight(JSON.stringify(value, null, 2)),
    [value],
  );
  return (
    <pre
      className={cn(
        'overflow-x-auto font-mono text-[12.5px] leading-[1.6] whitespace-pre',
        className,
      )}
    >
      {content}
    </pre>
  );
}
