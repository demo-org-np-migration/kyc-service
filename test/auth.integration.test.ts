import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';

// A diferencia de applications.test.ts, ACÁ NO mockeamos createJwtAuth: este test
// existe justo para probar que el hook de auth de verdad protege /v1/kyc/*. El
// issuer apunta a un puerto que no escucha nada: sin header Authorization, la lib
// rechaza antes de intentar resolver el JWKS, así que nunca llega a pegarle a esa URL.
process.env.KEYCLOAK_ISSUER = 'http://127.0.0.1:1/realms/x';
process.env.KEYCLOAK_CLIENT_ID = 'kyc-service';
process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret';
process.env.VERIDOC_URL = 'http://127.0.0.1:1';
process.env.VERIDOC_API_KEY = 'veridoc-key';
process.env.LEDGER_CORE_URL = 'http://127.0.0.1:1';
process.env.AWS_ENDPOINT_URL = 'http://127.0.0.1:1';
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET_PREFIX = 'cauri-test-';
process.env.SQS_QUEUE_PREFIX = 'test-';

const { buildServer } = await import('../src/server');

const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

describe('auth real de @cauri/commons sobre /v1/kyc', () => {
  beforeEach(() => {
    s3Mock.reset();
    sqsMock.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /v1/kyc/applications sin Authorization devuelve 401 y no ejecuta el flujo', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/kyc/applications',
      payload: { customer_id: 'customer-1', document_base64: 'ZG9j', document_type: 'dni' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'unauthorized', message: 'missing bearer token' } });
    expect(s3Mock.calls()).toHaveLength(0);
    expect(sqsMock.calls()).toHaveLength(0);

    await app.close();
  });

  it('GET /v1/kyc/applications/:id sin Authorization devuelve 401', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/kyc/applications/x',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'unauthorized', message: 'missing bearer token' } });
    expect(s3Mock.calls()).toHaveLength(0);

    await app.close();
  });

  it('/health y /metrics siguen públicos (no deben quedar atrapados por el hook de auth)', async () => {
    const app = buildServer();

    const health = await app.inject({ method: 'GET', url: '/health' });
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });

    expect(health.statusCode).toBe(200);
    expect(metrics.statusCode).toBe(200);

    await app.close();
  });
});
