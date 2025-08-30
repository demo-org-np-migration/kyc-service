function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`missing required env var ${name}`);
  }
  return value;
}

export const config = {
  serviceName: process.env.SERVICE_NAME ?? 'kyc-service',
  env: process.env.ENV ?? 'staging',
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  keycloakIssuer: required('KEYCLOAK_ISSUER'),
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? 'kyc-service',
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? '',

  awsEndpointUrl: required('AWS_ENDPOINT_URL'),
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',

  s3BucketPrefix: process.env.S3_BUCKET_PREFIX ?? 'cauri-staging-',
  sqsQueuePrefix: process.env.SQS_QUEUE_PREFIX ?? 'staging-',

  veridocUrl: required('VERIDOC_URL'),
  veridocApiKey: process.env.VERIDOC_API_KEY ?? '',

  ledgerCoreUrl: required('LEDGER_CORE_URL'),
};

export const kycDocumentsBucket = `${config.s3BucketPrefix}kyc-documents`;
export const kycEventsQueue = `${config.sqsQueuePrefix}kyc-events`;
