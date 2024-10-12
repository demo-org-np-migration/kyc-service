import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { config, kycEventsQueue } from '../config';
import type { KycStatus } from '../types';

const sqs = new SQSClient({
  endpoint: config.awsEndpointUrl,
  region: config.awsRegion,
  credentials: {
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

function queueUrl(): string {
  // LocalStack acepta el nombre de cola como "url" con forcePathStyle a nivel cuenta default.
  return `${config.awsEndpointUrl}/000000000000/${kycEventsQueue}`;
}

/**
 * Publica en `<SQS_QUEUE_PREFIX>kyc-events` cada vez que se decide un KYC. Hoy no hay
 * ningún consumidor registrado para esta cola (ver README: "quién consume kyc-events?").
 */
export async function publishKycDecided(customerId: string, status: KycStatus): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl(),
      MessageBody: JSON.stringify({
        type: 'kyc.decided',
        customer_id: customerId,
        status,
      }),
    }),
  );
}
