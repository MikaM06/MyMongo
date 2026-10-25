import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {json} from '@codemirror/lang-json';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {Prec} from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
} from '@codemirror/view';
import {tags} from '@lezer/highlight';
import CodeMirror from '@uiw/react-codemirror';
import {useEffect, useMemo, useRef} from 'react';
import {cn} from '../lib/cn';

const QUERY_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$and',
  '$or',
  '$nor',
  '$not',
  '$exists',
  '$type',
  '$regex',
  '$options',
  '$elemMatch',
  '$size',
  '$all',
  '$expr',
  '$mod',
  '$text',
  '$search',
  '$near',
  '$geoWithin',
];

const STAGES = [
  '$match',
  '$project',
  '$group',
  '$sort',
  '$limit',
  '$skip',
  '$unwind',
  '$lookup',
  '$addFields',
  '$set',
  '$unset',
  '$count',
  '$facet',
  '$bucket',
  '$bucketAuto',
  '$sortByCount',
  '$replaceRoot',
  '$replaceWith',
  '$sample',
  '$unionWith',
  '$graphLookup',
  '$densify',
  '$fill',
  '$setWindowFields',
  '$out',
  '$merge',
];

const EXPRESSIONS = [
  '$sum',
  '$avg',
  '$min',
  '$max',
  '$first',
  '$last',
  '$push',
  '$addToSet',
  '$count',
  '$concat',
  '$toUpper',
  '$toLower',
  '$substr',
  '$dateToString',
  '$year',
  '$month',
  '$dayOfMonth',
  '$cond',
  '$ifNull',
  '$size',
  '$filter',
  '$map',
  '$reduce',
  '$arrayElemAt',
  '$toString',
  '$toInt',
  '$toDouble',
  '$toDate',
  '$multiply',
  '$divide',
  '$add',
  '$subtract',
  '$round',
];

const HELPERS: Completion[] = [
  {
    label: 'ObjectId("")',
    type: 'function',
    detail: 'ObjectId',
    apply: 'ObjectId("")',
  },
  {
    label: 'ISODate("")',
    type: 'function',
    detail: 'Date',
    apply: `ISODate("${new Date().toISOString()}")`,
  },
  {label: 'NumberLong("")', type: 'function', detail: 'Int64'},
  {label: 'NumberInt()', type: 'function', detail: 'Int32'},
  {label: 'NumberDecimal("")', type: 'function', detail: 'Decimal128'},
  {label: 'UUID("")', type: 'function', detail: 'UUID'},
];

const highlight = HighlightStyle.define([
  {tag: tags.propertyName, color: 'var(--t-key)'},
  {tag: tags.string, color: 'var(--t-string)'},
  {tag: tags.number, color: 'var(--t-number)'},
  {tag: [tags.bool, tags.null], color: 'var(--t-bool)'},
  {tag: tags.keyword, color: 'var(--t-bool)'},
  {
    tag: [tags.brace, tags.squareBracket, tags.separator],
    color: 'var(--faint)',
  },
  {tag: tags.invalid, color: 'var(--danger)'},
]);

const theme = EditorView.theme({
  '&': {color: 'var(--text)', backgroundColor: 'transparent'},
  '.cm-content': {caretColor: 'var(--brand)', padding: '10px 0'},
  '.cm-cursor': {borderLeftColor: 'var(--brand)'},
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--faint)',
    border: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--hover) 60%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--muted)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
    {
      backgroundColor: 'rgb(0 237 100 / 0.22) !important',
    },
  '.cm-matchingBracket': {
    backgroundColor: 'rgb(0 237 100 / 0.18)',
    outline: 'none',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--line)',
    color: 'var(--text)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--hover)',
    color: 'var(--text)',
  },
  '.cm-completionDetail': {color: 'var(--faint)', fontStyle: 'normal'},
  '.cm-placeholder': {color: 'var(--faint)'},
});

function completions(fields: string[], mode: 'query' | 'pipeline') {
  const operators =
    mode === 'pipeline'
      ? [...STAGES, ...QUERY_OPERATORS, ...EXPRESSIONS]
      : QUERY_OPERATORS;
  const operatorOptions: Completion[] = [...new Set(operators)].map(label => ({
    label,
    type: 'keyword',
    detail: STAGES.includes(label) ? 'étape' : 'opérateur',
  }));
  const fieldOptions: Completion[] = fields.flatMap(path => [
    {label: path, type: 'property', detail: 'champ', boost: 2},
    {label: `$${path}`, type: 'variable', detail: 'référence', boost: -1},
  ]);
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/["']?[$\w.]*/);
    if (!word || (word.from === word.to && !context.explicit)) {
      return null;
    }
    const quoted = /^["']/.test(word.text);
    const from = quoted ? word.from + 1 : word.from;
    return {
      from,
      options: [
        ...fieldOptions,
        ...operatorOptions,
        ...(quoted ? [] : HELPERS),
      ],
      validFor: /^[$\w.]*$/,
    };
  };
}

export function JsonEditor({
  value,
  onChange,
  onRun,
  fields = [],
  mode = 'query',
  minHeight = '120px',
  maxHeight,
  placeholder,
  readOnly,
  className,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onChange?: (value: string) => void;
  onRun?: () => void;
  fields?: string[];
  mode?: 'query' | 'pipeline' | 'document';
  minHeight?: string;
  maxHeight?: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  autoFocus?: boolean;
  ariaLabel: string;
}) {
  const runRef = useRef(onRun);
  useEffect(() => {
    runRef.current = onRun;
  }, [onRun]);
  const extensions = useMemo(
    () => [
      json(),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({'aria-label': ariaLabel}),
      autocompletion({
        override: [
          completions(fields, mode === 'pipeline' ? 'pipeline' : 'query'),
        ],
        icons: false,
      }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current?.();
              return true;
            },
          },
        ]),
      ),
      ...(placeholder ? [placeholderExt(placeholder)] : []),
    ],
    [fields, mode, placeholder, ariaLabel],
  );
  return (
    <div
      className={cn(
        'overflow-hidden rounded border border-line bg-panel transition-colors focus-within:border-info focus-within:ring-1 focus-within:ring-info/15',
        className,
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        readOnly={readOnly}
        editable={!readOnly}
        autoFocus={autoFocus}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{
          lineNumbers: mode !== 'query',
          foldGutter: mode !== 'query',
          highlightActiveLine: mode !== 'query',
          highlightActiveLineGutter: mode !== 'query',
          autocompletion: false,
          searchKeymap: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
          tabSize: 2,
        }}
      />
    </div>
  );
}

export function formatJsonText(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}
