import { metrics as commonsMetrics } from '@cauri/commons';
import type { FastifyInstance } from 'fastify';

// `metrics().handler()` de @cauri/commons está pensado para Express (usa req.path,
// res.status().send()); Fastify no expone esa interfaz. Reusamos el mismo `registry`
// (métricas default de proceso + el histograma declarado) y lo servimos nosotros mismos
// en /metrics, que es lo que pide las convenciones internas de API (formato Prometheus).
export function registerMetrics(app: FastifyInstance): void {
  const { registry } = commonsMetrics();

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
