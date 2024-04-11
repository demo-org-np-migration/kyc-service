import { httpClient, serviceTokenProvider } from '@cauri/commons';
import { config } from '../config';
import type { KycStatus } from '../types';

// kyc-service llama a ledger-core como servicio (client credentials, client "kyc-service").
const serviceToken = serviceTokenProvider({
  issuer: config.keycloakIssuer,
  clientId: config.keycloakClientId,
  clientSecret: config.keycloakClientSecret,
});

const ledger = httpClient({
  baseUrl: config.ledgerCoreUrl,
  getToken: () => serviceToken.getToken(),
  retries: 2,
  timeoutMs: 5000,
});

export async function updateKycStatus(customerId: string, kycStatus: KycStatus): Promise<void> {
  await ledger.patch(`/v1/customers/${customerId}/kyc-status`, { kyc_status: kycStatus });
}
