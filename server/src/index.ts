import {buildApp} from './app.js';
import {loadConfig} from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const {app, context} = await buildApp(config);
  if (!config.connections.length) {
    app.log.warn(
      'Aucune connexion MongoDB configurée : définissez MONGODB_URI ou MYMONGO_CONNECTION_<NOM>_URI.',
    );
  }
  if (context.users.count() === 0) {
    app.log.warn(
      'Aucun utilisateur MyMongo : créez un administrateur avec « node dist/cli.js user add <nom> --role admin ».',
    );
  }
  if (config.env === 'production' && !config.secureCookies) {
    app.log.warn(
      'Cookies non sécurisés en production : servez MyMongo derrière HTTPS et laissez MYMONGO_SECURE_COOKIES=true.',
    );
  }
  const shutdown = async (signal: string) => {
    app.log.info(`Arrêt (${signal})`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({host: config.host, port: config.port});
  app.log.info(
    {connections: context.registry.list().map(item => item.id)},
    `MyMongo ${context.version} prêt`,
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
