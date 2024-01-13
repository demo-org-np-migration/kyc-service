import { httpClient } from '@cauri/commons';
import { config } from '../config';

export type VeridocResult = 'approved' | 'rejected' | 'manual_review';

export interface VeridocVerifyResponse {
  result: VeridocResult;
  reference: string;
}

// Veridoc no es un servicio Cauri: no lleva token de Keycloak, se autentica con
// X-Api-Key (las convenciones internas de API). Usamos httpClient igual para heredar reintentos y logging.
const veridoc = httpClient({
  baseUrl: config.veridocUrl,
  retries: 2,
  timeoutMs: 5000,
});

export async function verifyDocument(customerId: string, documentUrl: string): Promise<VeridocVerifyResponse> {
  return veridoc.post<VeridocVerifyResponse>(
    '/v1/verify',
    { customer_id: customerId, document_url: documentUrl },
    { headers: { 'X-Api-Key': config.veridocApiKey } },
  );
}
