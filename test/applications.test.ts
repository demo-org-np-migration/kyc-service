import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

process.env.KEYCLOAK_ISSUER = 'http://keycloak.test/realms/cauri-test';
process.env.KEYCLOAK_CLIENT_ID = 'kyc-service';
process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret';
process.env.VERIDOC_URL = 'http://veridoc.test';
process.env.VERIDOC_API_KEY = 'veridoc-key';
process.env.LEDGER_CORE_URL = 'http://ledger-core.test';
process.env.AWS_ENDPOINT_URL = 'http://localstack.test:4566';
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET_PREFIX = 'cauri-test-';
process.env.SQS_QUEUE_PREFIX = 'test-';

// La verificación real de JWT contra JWKS de Keycloak no aplica a un test unitario:
// simulamos createJwtAuth para que cualquier request llegue autenticada, y dejamos el
// resto de @cauri/commons (httpClient, logger, serviceTokenProvider) tal cual, porque
// eso sí es lo que este servicio integra de la lib compartida.
vi.mock('@cauri/commons', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cauri/commons')>();
  return {
    ...actual,
    createJwtAuth: () => ({
      express: () => (_req: unknown, _res: unknown, next: () => void) => next(),
      fastify: () => async (instance: import('fastify').FastifyInstance) => {
        instance.addHook('onRequest', async (request) => {
          (request as { user?: unknown }).user = { sub: 'customer-1', roles: ['customer'] };
        });
      },
      requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    }),
  };
});

// Import dinámico: los módulos de src/ (config.ts) leen process.env al cargarse,
// así que hay que importarlos recién después de setear las env vars de arriba.
const { buildServer } = await import('../src/server');

const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

function bodyStream(value: string) {
  return Readable.from([Buffer.from(value)]);
}

describe('kyc-service /v1/kyc/applications', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    s3Mock.reset();
    sqsMock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });

    fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'svc-token', expires_in: 300 }), { status: 200 });
      }
      if (url.includes('/v1/verify')) {
        return new Response(JSON.stringify({ result: 'approved', reference: 'veridoc-ref-1' }), { status: 200 });
      }
      if (url.includes('/kyc-status')) {
        return new Response(JSON.stringify({ id: 'customer-1', kyc_status: 'approved' }), { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the application: sube a S3, verifica con Veridoc, actualiza ledger-core y publica el evento', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/kyc/applications',
      headers: { authorization: 'Bearer irrelevant-in-test' },
      payload: {
        customer_id: 'customer-1',
        document_base64: Buffer.from('fake-document').toString('base64'),
        document_type: 'dni',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.customer_id).toBe('customer-1');
    expect(body.status).toBe('approved');
    expect(body.document_url).toContain('cauri-test-kyc-documents/customer-1/');
    expect(body.provider_reference).toBe('veridoc-ref-1');

    // sube el documento y el snapshot de la application (dos PutObject)
    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(2);
    expect(puts[0].args[0].input.Bucket).toBe('cauri-test-kyc-documents');
    expect(puts[1].args[0].input.Key).toBe(`applications/${body.id}.json`);

    // publica en la cola de kyc-events
    const sent = sqsMock.commandCalls(SendMessageCommand);
    expect(sent).toHaveLength(1);
    const message = JSON.parse(sent[0].args[0].input.MessageBody as string);
    expect(message).toEqual({ type: 'kyc.decided', customer_id: 'customer-1', status: 'approved' });

    // le pega a ledger-core con el kyc_status mapeado
    const ledgerCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/kyc-status'));
    expect(ledgerCall).toBeDefined();
    expect(JSON.parse(ledgerCall![1].body as string)).toEqual({ kyc_status: 'approved' });

    await app.close();
  });

  it('mapea manual_review de Veridoc al kyc_status', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'svc-token', expires_in: 300 }), { status: 200 });
      }
      if (url.includes('/v1/verify')) {
        return new Response(JSON.stringify({ result: 'manual_review', reference: 'veridoc-ref-2' }), { status: 200 });
      }
      if (url.includes('/kyc-status')) {
        return new Response(JSON.stringify({ id: 'customer-1', kyc_status: 'manual_review' }), { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/kyc/applications',
      headers: { authorization: 'Bearer irrelevant-in-test' },
      payload: {
        customer_id: 'customer-1',
        document_base64: Buffer.from('fake-document').toString('base64'),
        document_type: 'dni',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('manual_review');

    const message = JSON.parse(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody as string);
    expect(message.status).toBe('manual_review');

    await app.close();
  });

  it('devuelve 400 si falta un campo requerido', async () => {
    const app = buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/kyc/applications',
      headers: { authorization: 'Bearer irrelevant-in-test' },
      payload: { customer_id: 'customer-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_body');
    await app.close();
  });

  it('GET /v1/kyc/applications/:id lee el snapshot desde S3', async () => {
    const stored = {
      id: 'app-1',
      customer_id: 'customer-1',
      status: 'approved',
      document_url: 'http://localstack.test:4566/cauri-test-kyc-documents/customer-1/doc.jpg',
      provider_reference: 'veridoc-ref-1',
      created_at: '2026-09-09T12:00:00.000Z',
    };
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyStream(JSON.stringify(stored)) as never });

    const app = buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/kyc/applications/app-1',
      headers: { authorization: 'Bearer irrelevant-in-test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(stored);
    await app.close();
  });

  it('GET /v1/kyc/applications/:id devuelve 404 si no existe', async () => {
    s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));

    const app = buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/kyc/applications/does-not-exist',
      headers: { authorization: 'Bearer irrelevant-in-test' },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('GET /v1/kyc/customers/:customer_id/applications filtra por cliente listando el bucket', async () => {
    const mine = {
      id: 'app-1',
      customer_id: 'customer-1',
      status: 'approved',
      document_url: 'http://localstack.test:4566/x',
      provider_reference: 'ref-1',
      created_at: '2026-09-09T12:00:00.000Z',
    };
    const someoneElses = { ...mine, id: 'app-2', customer_id: 'customer-2' };

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: 'applications/app-1.json' }, { Key: 'applications/app-2.json' }],
      IsTruncated: false,
    });
    s3Mock
      .on(GetObjectCommand, { Bucket: 'cauri-test-kyc-documents', Key: 'applications/app-1.json' })
      .resolves({ Body: bodyStream(JSON.stringify(mine)) as never });
    s3Mock
      .on(GetObjectCommand, { Bucket: 'cauri-test-kyc-documents', Key: 'applications/app-2.json' })
      .resolves({ Body: bodyStream(JSON.stringify(someoneElses)) as never });

    const app = buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/kyc/customers/customer-1/applications',
      headers: { authorization: 'Bearer irrelevant-in-test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([mine]);
    await app.close();
  });
});
