import {parseArgs} from 'node:util';
import {ROLES, type Role, UserStore} from './auth/users.js';
import {loadConfig} from './config.js';
import {HttpError} from './lib/errors.js';

const USAGE = `Utilisation :
  user list
  user add <identifiant> [--role admin|readonly] [--password-stdin]
  user passwd <identifiant> [--password-stdin]
  user role <identifiant> <admin|readonly>
  user remove <identifiant>`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      reject(
        new Error('Aucun terminal interactif : utilisez --password-stdin.'),
      );
      return;
    }
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const onData = (char: string) => {
      if (char === '\r' || char === '\n') {
        input.setRawMode(false);
        input.pause();
        input.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '\u0003') {
        input.setRawMode(false);
        process.exit(130);
      } else if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    input.on('data', onData);
  });
}

async function readPassword(fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    return readStdin();
  }
  const first = await promptHidden('Mot de passe : ');
  const second = await promptHidden('Confirmation : ');
  if (first !== second) {
    throw new Error('Les mots de passe ne correspondent pas.');
  }
  return first;
}

function parseRole(value: string | undefined): Role {
  if (!value || !(ROLES as readonly string[]).includes(value)) {
    throw new Error(`Rôle invalide : ${ROLES.join(' ou ')}.`);
  }
  return value as Role;
}

async function main(): Promise<void> {
  const {positionals, values} = parseArgs({
    allowPositionals: true,
    options: {
      role: {type: 'string', default: 'admin'},
      'password-stdin': {type: 'boolean', default: false},
    },
  });
  const [scope, command, username, extra] = positionals;
  if (scope !== 'user' || !command) {
    console.log(USAGE);
    process.exit(scope ? 1 : 0);
  }
  const config = loadConfig();
  const store = new UserStore(config.dataDir);
  await store.load();
  const requireName = () => {
    if (!username) {
      throw new Error(USAGE);
    }
    return username;
  };
  switch (command) {
    case 'list':
      for (const user of store.list()) {
        console.log(`${user.username}\t${user.role}\t${user.createdAt}`);
      }
      if (!store.count()) {
        console.log('Aucun utilisateur.');
      }
      break;
    case 'add': {
      const name = requireName();
      const role = parseRole(values.role);
      const password = await readPassword(values['password-stdin']);
      await store.create(name, password, role);
      console.log(`Utilisateur « ${name} » créé (${role}).`);
      break;
    }
    case 'passwd': {
      const name = requireName();
      const password = await readPassword(values['password-stdin']);
      await store.update(name, {password});
      console.log(`Mot de passe de « ${name} » mis à jour.`);
      break;
    }
    case 'role': {
      const name = requireName();
      await store.update(name, {role: parseRole(extra)});
      console.log(`Rôle de « ${name} » mis à jour.`);
      break;
    }
    case 'remove': {
      const name = requireName();
      await store.remove(name);
      console.log(`Utilisateur « ${name} » supprimé.`);
      break;
    }
    default:
      throw new Error(USAGE);
  }
}

main().catch(error => {
  console.error(
    error instanceof HttpError || error instanceof Error
      ? error.message
      : error,
  );
  process.exit(1);
});
