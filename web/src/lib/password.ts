const GROUPS = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '-_.!@#%+=',
];

function pick(alphabet: string): string {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return alphabet[value % alphabet.length];
}

export function generatePassword(length = 20): string {
  const all = GROUPS.join('');
  const chars = GROUPS.map(pick);
  while (chars.length < length) {
    chars.push(pick(all));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    const j = value % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function passwordProblem(password: string): string | null {
  if (!password) {
    return null;
  }
  if (password.length < 12) {
    return '12 caractères minimum.';
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(pattern =>
    pattern.test(password),
  ).length;
  return classes < 3
    ? 'Mélangez au moins trois types : minuscules, majuscules, chiffres, symboles.'
    : null;
}
