import Fastify from 'fastify';
import { logger } from '@cauri/commons';
import { config } from './config';
import { auth } from './auth';
import { registerMetrics } from './metrics';
import applicationsRoutes from './routes/applications';

const log = logger(config.serviceName, config.env);

export function buildServer() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));
  registerMetrics(app);

  // @cauri/commons@1.2.1 envuelve auth.fastify() con fastify-plugin: el hook onRequest
  // se registra en el scope que lo llama (acá, "secured"), no en un hijo propio del
  // plugin de auth. Por eso alcanza a applicationsRoutes, que es su hermano dentro de
  // "secured" (antes de 1.2.1 el hook quedaba atrapado en el plugin de auth y las rutas
  // de /v1/kyc quedaban sin proteger: CVE interno, ver postmortem).
  // Ese mismo mecanismo es la razón por la que auth y las rutas van en un sub-app
  // aparte en vez de directo en `app`: si los registrábamos ahí, el hook se hubiera
  // colado también a /health y /metrics.
  app.register(async (secured) => {
    await secured.register(auth.fastify());
    await secured.register(applicationsRoutes);
  });

  app.setErrorHandler((error, _request, reply) => {
    log.error({ err: error }, 'unhandled error');
    const status = error.statusCode ?? 500;
    reply.code(status).send({
      error: { code: status === 500 ? 'internal_error' : 'bad_request', message: error.message },
    });
  });

  return app;
}

async function main() {
  const app = buildServer();
  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
    log.info({ port: config.port }, 'kyc-service listening');
  } catch (err) {
    log.error({ err }, 'failed to start kyc-service');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
