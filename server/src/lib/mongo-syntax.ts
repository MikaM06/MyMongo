import {BSON, ObjectId} from 'mongodb';

export class SyntaxParseError extends Error {
  constructor(
    readonly reason: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`Ligne ${line}, colonne ${column} : ${reason}`);
    this.name = 'SyntaxParseError';
  }

  withLabel(label: string): SyntaxParseError {
    return new SyntaxParseError(
      `${label} — ${this.reason}`,
      this.line,
      this.column,
    );
  }
}

type Json = null | boolean | number | string | Json[] | {[key: string]: Json};

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$.]/;
const HEX_24 = /^[0-9a-fA-F]{24}$/;
const MAX_DEPTH = 100;

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly text: string) {}

  parse(): Json {
    this.skipWhitespace();
    if (this.pos >= this.text.length) {
      this.fail('expression vide');
    }
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      this.fail(`caractère inattendu « ${this.text[this.pos]} »`);
    }
    return value;
  }

  private fail(message: string, at = this.pos): never {
    let line = 1;
    let column = 1;
    for (let i = 0; i < at && i < this.text.length; i++) {
      if (this.text[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    throw new SyntaxParseError(message, line, column);
  }

  private peek(): string {
    return this.text[this.pos] ?? '';
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const char = this.text[this.pos];
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        this.pos++;
      } else if (char === '/' && this.text[this.pos + 1] === '/') {
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') {
          this.pos++;
        }
      } else if (char === '/' && this.text[this.pos + 1] === '*') {
        const end = this.text.indexOf('*/', this.pos + 2);
        if (end === -1) {
          this.fail('commentaire non terminé');
        }
        this.pos = end + 2;
      } else {
        break;
      }
    }
  }

  private expect(char: string): void {
    this.skipWhitespace();
    if (this.peek() !== char) {
      this.fail(
        this.pos >= this.text.length
          ? `« ${char} » attendu mais fin du texte atteinte`
          : `« ${char} » attendu, « ${this.peek()} » trouvé`,
      );
    }
    this.pos++;
  }

  private parseValue(): Json {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '{') {
      return this.nested(() => this.parseObject());
    }
    if (char === '[') {
      return this.nested(() => this.parseArray());
    }
    if (char === '"' || char === "'") {
      return this.parseString();
    }
    if (char === '-' || char === '+' || char === '.' || /[0-9]/.test(char)) {
      return this.parseNumber();
    }
    if (char === '/') {
      return this.parseRegex();
    }
    if (IDENTIFIER_START.test(char)) {
      return this.parseIdentifierValue();
    }
    if (!char) {
      this.fail('valeur attendue mais fin du texte atteinte');
    }
    return this.fail(`valeur attendue, « ${char} » trouvé`);
  }

  private nested(parse: () => Json): Json {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      this.fail('imbrication trop profonde');
    }
    const value = parse();
    this.depth--;
    return value;
  }

  private parseObject(): Json {
    const result: {[key: string]: Json} = {};
    this.pos++;
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      const keyStart = this.pos;
      const key = this.parseKey();
      if (key === '__proto__') {
        this.fail('clé « __proto__ » interdite', keyStart);
      }
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        this.fail(`clé « ${key} » dupliquée`, keyStart);
      }
      this.expect(':');
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWhitespace();
        if (this.peek() === '}') {
          this.pos++;
          return result;
        }
        continue;
      }
      if (this.peek() === '}') {
        this.pos++;
        return result;
      }
      this.fail(
        this.pos >= this.text.length
          ? 'objet non fermé : « } » manquant'
          : `« , » ou « } » attendu, « ${this.peek()} » trouvé`,
      );
    }
  }

  private parseKey(): string {
    const char = this.peek();
    if (char === '"' || char === "'") {
      return this.parseString();
    }
    if (IDENTIFIER_START.test(char)) {
      const start = this.pos;
      while (IDENTIFIER_PART.test(this.peek())) {
        this.pos++;
      }
      return this.text.slice(start, this.pos);
    }
    return this.fail(
      char
        ? `nom de champ attendu, « ${char} » trouvé`
        : 'nom de champ attendu',
    );
  }

  private parseArray(): Json {
    const result: Json[] = [];
    this.pos++;
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.pos++;
      return result;
    }
    for (;;) {
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.pos++;
        this.skipWhitespace();
        if (this.peek() === ']') {
          this.pos++;
          return result;
        }
        continue;
      }
      if (this.peek() === ']') {
        this.pos++;
        return result;
      }
      this.fail(
        this.pos >= this.text.length
          ? 'tableau non fermé : « ] » manquant'
          : `« , » ou « ] » attendu, « ${this.peek()} » trouvé`,
      );
    }
  }

  private parseString(): string {
    const quote = this.peek();
    const start = this.pos;
    this.pos++;
    let result = '';
    for (;;) {
      if (this.pos >= this.text.length) {
        this.fail('chaîne non terminée', start);
      }
      const char = this.text[this.pos];
      if (char === quote) {
        this.pos++;
        return result;
      }
      if (char === '\n') {
        this.fail('retour à la ligne dans une chaîne', this.pos);
      }
      if (char === '\\') {
        result += this.parseEscape();
        continue;
      }
      result += char;
      this.pos++;
    }
  }

  private parseEscape(): string {
    this.pos++;
    const char = this.text[this.pos];
    this.pos++;
    switch (char) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '0':
        return '\0';
      case 'u': {
        const hex = this.text.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.fail('séquence \\u invalide');
        }
        this.pos += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      case undefined:
        return this.fail('chaîne non terminée');
      default:
        return char;
    }
  }

  private parseNumber(): Json {
    const start = this.pos;
    const match = /^[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(
      this.text.slice(this.pos),
    );
    if (!match) {
      this.fail('nombre invalide');
    }
    this.pos += match[0].length;
    if (IDENTIFIER_PART.test(this.peek()) && this.peek() !== '.') {
      this.fail('nombre invalide', start);
    }
    const raw = match[0].replace(/^\+/, '');
    if (raw.endsWith('Infinity')) {
      return {$numberDouble: raw};
    }
    if (/^-?\d+$/.test(raw)) {
      const value = Number(raw);
      if (Number.isSafeInteger(value)) {
        return value;
      }
      const big = BigInt(raw);
      if (big >= INT64_MIN && big <= INT64_MAX) {
        return {$numberLong: big.toString()};
      }
      return {$numberDouble: raw};
    }
    const value = Number(raw);
    if (Number.isInteger(value)) {
      return {$numberDouble: raw};
    }
    return value;
  }

  private parseRegex(): Json {
    const start = this.pos;
    this.pos++;
    let pattern = '';
    let inClass = false;
    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined || char === '\n') {
        this.fail('expression régulière non terminée', start);
      }
      if (char === '\\') {
        pattern += char + (this.text[this.pos + 1] ?? '');
        this.pos += 2;
        continue;
      }
      if (char === '[') {
        inClass = true;
      } else if (char === ']') {
        inClass = false;
      } else if (char === '/' && !inClass) {
        this.pos++;
        break;
      }
      pattern += char;
      this.pos++;
    }
    let options = '';
    while (/[a-z]/.test(this.peek())) {
      options += this.peek();
      this.pos++;
    }
    return this.regex(pattern, options, start);
  }

  private regex(pattern: string, options: string, at: number): Json {
    if (!/^[imsxu]*$/.test(options)) {
      this.fail(`options d'expression régulière invalides « ${options} »`, at);
    }
    try {
      new RegExp(pattern, options.replace(/x/g, ''));
    } catch {
      this.fail('expression régulière invalide', at);
    }
    return {
      $regularExpression: {
        pattern,
        options: [...new Set(options)].sort().join(''),
      },
    };
  }

  private parseIdentifierValue(): Json {
    const start = this.pos;
    let name = this.readIdentifier();
    if (name === 'new') {
      this.skipWhitespace();
      name = this.readIdentifier();
    }
    switch (name) {
      case 'true':
        return true;
      case 'false':
        return false;
      case 'null':
        return null;
      case 'Infinity':
        return {$numberDouble: 'Infinity'};
      case 'NaN':
        return {$numberDouble: 'NaN'};
      case 'MinKey':
      case 'MaxKey':
        this.parseOptionalCall();
        return name === 'MinKey' ? {$minKey: 1} : {$maxKey: 1};
      default:
        break;
    }
    this.skipWhitespace();
    if (this.peek() !== '(') {
      this.fail(`identifiant inconnu « ${name} »`, start);
    }
    const args = this.parseArguments();
    return this.construct(name, args, start);
  }

  private readIdentifier(): string {
    const start = this.pos;
    while (/[A-Za-z0-9_$]/.test(this.peek())) {
      this.pos++;
    }
    if (start === this.pos) {
      this.fail('identifiant attendu');
    }
    return this.text.slice(start, this.pos);
  }

  private parseOptionalCall(): void {
    this.skipWhitespace();
    if (this.peek() === '(') {
      this.pos++;
      this.expect(')');
    }
  }

  private parseArguments(): Json[] {
    this.pos++;
    const args: Json[] = [];
    this.skipWhitespace();
    if (this.peek() === ')') {
      this.pos++;
      return args;
    }
    for (;;) {
      args.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      this.expect(')');
      return args;
    }
  }

  private construct(name: string, args: Json[], at: number): Json {
    const first = args[0];
    const asText = (value: Json): string | undefined => {
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'number') {
        return String(value);
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const inner =
          value.$numberLong ?? value.$numberDouble ?? value.$numberInt;
        return typeof inner === 'string' ? inner : undefined;
      }
      return undefined;
    };
    switch (name) {
      case 'ObjectId': {
        if (first === undefined) {
          return {$oid: new ObjectId().toHexString()};
        }
        if (typeof first !== 'string' || !HEX_24.test(first)) {
          return this.fail(
            'ObjectId attend 24 caractères hexadécimaux entre guillemets',
            at,
          );
        }
        return {$oid: first.toLowerCase()};
      }
      case 'ISODate':
      case 'Date': {
        if (first === undefined) {
          return {$date: new Date().toISOString()};
        }
        const date =
          typeof first === 'number'
            ? new Date(first)
            : typeof first === 'string'
              ? new Date(first)
              : new Date(NaN);
        if (Number.isNaN(date.getTime())) {
          return this.fail('date invalide', at);
        }
        return {$date: {$numberLong: String(date.getTime())}};
      }
      case 'NumberLong':
      case 'Long': {
        const text = asText(first);
        if (text === undefined || !/^-?\d+$/.test(text)) {
          return this.fail(`${name} attend un entier`, at);
        }
        const big = BigInt(text);
        if (big < INT64_MIN || big > INT64_MAX) {
          return this.fail('entier hors limites pour Int64', at);
        }
        return {$numberLong: big.toString()};
      }
      case 'NumberInt':
      case 'Int32': {
        const text = asText(first);
        const value = Number(text);
        if (
          text === undefined ||
          !Number.isInteger(value) ||
          value < -(2 ** 31) ||
          value > 2 ** 31 - 1
        ) {
          return this.fail(`${name} attend un entier 32 bits`, at);
        }
        return {$numberInt: String(value)};
      }
      case 'Double': {
        const text = asText(first);
        if (text === undefined || Number.isNaN(Number(text))) {
          return this.fail('Double attend un nombre', at);
        }
        return {$numberDouble: text};
      }
      case 'NumberDecimal':
      case 'Decimal128': {
        const text = asText(first);
        if (text === undefined) {
          return this.fail(`${name} attend une valeur numérique`, at);
        }
        try {
          BSON.Decimal128.fromString(text);
        } catch {
          return this.fail('nombre décimal invalide', at);
        }
        return {$numberDecimal: text};
      }
      case 'UUID': {
        if (first === undefined) {
          return {$uuid: new BSON.UUID().toHexString(true)};
        }
        if (
          typeof first !== 'string' ||
          !/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(
            first,
          )
        ) {
          return this.fail('UUID invalide', at);
        }
        return {$uuid: first.toLowerCase()};
      }
      case 'Timestamp': {
        const [t, i] = args;
        if (typeof t !== 'number' || typeof i !== 'number') {
          return this.fail('Timestamp attend deux entiers (t, i)', at);
        }
        return {$timestamp: {t, i}};
      }
      case 'BinData': {
        const [subType, base64] = args;
        if (typeof subType !== 'number' || typeof base64 !== 'string') {
          return this.fail('BinData attend (sous-type, base64)', at);
        }
        return {
          $binary: {base64, subType: subType.toString(16).padStart(2, '0')},
        };
      }
      case 'RegExp': {
        const [pattern, options] = args;
        if (typeof pattern !== 'string') {
          return this.fail('RegExp attend un motif', at);
        }
        return this.regex(
          pattern,
          typeof options === 'string' ? options : '',
          at,
        );
      }
      default:
        return this.fail(`fonction non prise en charge « ${name} »`, at);
    }
  }
}

export function parseExtendedJson(text: string): Json {
  return new Parser(text).parse();
}

export function parseMongoValue(text: string): unknown {
  const json = parseExtendedJson(text);
  return BSON.EJSON.deserialize(json as BSON.Document, {relaxed: false});
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function parseDocumentText(
  text: string | undefined,
  label: string,
): Record<string, unknown> {
  if (text === undefined || text.trim() === '') {
    return {};
  }
  let value: unknown;
  try {
    value = parseMongoValue(text);
  } catch (error) {
    throw error instanceof SyntaxParseError ? error.withLabel(label) : error;
  }
  if (!isPlainObject(value)) {
    throw new SyntaxParseError(`${label} — un objet { … } est attendu`, 1, 1);
  }
  return value;
}

export function parsePipelineText(text: string): Record<string, unknown>[] {
  let value: unknown;
  try {
    value = parseMongoValue(text);
  } catch (error) {
    throw error instanceof SyntaxParseError
      ? error.withLabel('Pipeline')
      : error;
  }
  if (isPlainObject(value)) {
    value = [value];
  }
  if (!Array.isArray(value) || !value.every(isPlainObject)) {
    throw new SyntaxParseError(
      'Pipeline — un tableau d’étapes [ { … }, … ] est attendu',
      1,
      1,
    );
  }
  return value;
}
