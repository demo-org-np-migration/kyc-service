import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { logger } from '@cauri/commons';
import { config } from '../config';
import { getApplication, listApplicationsByCustomer, saveApplication, uploadDocument } from '../services/storage';
import { verifyDocument } from '../services/veridoc';
import { updateKycStatus } from '../services/ledger';
import { publishKycDecided } from '../services/events';
import type { Application, KycStatus } from '../types';

const log = logger(config.serviceName, config.env);

interface CreateApplicationBody {
  customer_id?: string;
  document_base64?: string;
  document_type?: string;
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

// Veridoc devuelve el mismo vocabulario que usamos como kyc_status en ledger-core
// (las convenciones internas de API: customers.kyc_status), así que el mapeo es la identidad.
function mapVeridocResultToKycStatus(result: string): KycStatus {
  if (result === 'approved' || result === 'rejected' || result === 'manual_review') {
    return result;
  }
  throw new Error(`unexpected veridoc result: ${result}`);
}

const applicationsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: CreateApplicationBody }>('/v1/kyc/applications', async (request, reply) => {
    const { customer_id: customerId, document_base64: documentBase64, document_type: documentType } = request.body ?? {};

    if (!customerId || !documentBase64 || !documentType) {
      return reply
        .code(400)
        .send(errorBody('invalid_body', 'customer_id, document_base64 y document_type son requeridos'));
    }

    const { url: documentUrl } = await uploadDocument(customerId, documentBase64, documentType);
    log.info({ customer_id: customerId }, 'document uploaded to s3');

    const verification = await verifyDocument(customerId, documentUrl);
    const status = mapVeridocResultToKycStatus(verification.result);

    await updateKycStatus(customerId, status);
    await publishKycDecided(customerId, status);

    const application: Application = {
      id: randomUUID(),
      customer_id: customerId,
      status,
      document_url: documentUrl,
      provider_reference: verification.reference,
      created_at: new Date().toISOString(),
    };

    await saveApplication(application);
    log.info({ application_id: application.id, status }, 'kyc application decided');

    return reply.code(201).send(application);
  });

  app.get<{ Params: { id: string } }>('/v1/kyc/applications/:id', async (request, reply) => {
    const application = await getApplication(request.params.id);
    if (!application) {
      return reply.code(404).send(errorBody('not_found', `application ${request.params.id} not found`));
    }
    return application;
  });

  app.get<{ Params: { customer_id: string } }>(
    '/v1/kyc/customers/:customer_id/applications',
    async (request) => {
      return listApplicationsByCustomer(request.params.customer_id);
    },
  );
};

export default applicationsRoutes;
