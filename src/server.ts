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

  // El hook de auth queda encapsulado acá adentro: solo corre para las rutas de
  // /v1/kyc, no para /health ni /metrics.
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
