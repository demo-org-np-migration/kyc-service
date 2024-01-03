import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config, kycDocumentsBucket } from '../config';
import type { Application } from '../types';

const s3 = new S3Client({
  endpoint: config.awsEndpointUrl,
  region: config.awsRegion,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

function contentTypeFor(documentType: string): string {
  // documentType es "dni" | "pasaporte" | etc; el archivo siempre viaja como jpg (ver spec).
  return documentType ? 'image/jpeg' : 'application/octet-stream';
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // El SDK v3 devuelve un stream (Node) o un Blob (browser); acá siempre corre en Node.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export interface UploadedDocument {
  key: string;
  url: string;
}

/**
 * Sube el documento a `<S3_BUCKET_PREFIX>kyc-documents/<customer_id>/<uuid>.jpg` y devuelve
 * la URL pública del objeto: el bucket es público para que Veridoc pueda leer el documento
 * sin firmar URLs (lo crea así infra-terraform). Nadie más debería poder resolver esta URL,
 * pero al ser un bucket público, cualquiera con el link puede.
 */
export async function uploadDocument(
  customerId: string,
  documentBase64: string,
  documentType: string,
): Promise<UploadedDocument> {
  const key = `${customerId}/${randomUUID()}.jpg`;
  const body = Buffer.from(documentBase64, 'base64');

  await s3.send(
    new PutObjectCommand({
      Bucket: kycDocumentsBucket,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(documentType),
    }),
  );

  const url = `${config.awsEndpointUrl}/${kycDocumentsBucket}/${key}`;
  return { key, url };
}

function applicationKey(id: string): string {
  return `applications/${id}.json`;
}

export async function saveApplication(application: Application): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: kycDocumentsBucket,
      Key: applicationKey(application.id),
      Body: JSON.stringify(application),
      ContentType: 'application/json',
    }),
  );
}

export async function getApplication(id: string): Promise<Application | undefined> {
  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: kycDocumentsBucket, Key: applicationKey(id) }),
    );
    const buffer = await streamToBuffer(result.Body);
    return JSON.parse(buffer.toString('utf-8')) as Application;
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') {
      return undefined;
    }
    throw err;
  }
}

export async function listApplicationsByCustomer(customerId: string): Promise<Application[]> {
  const applications: Application[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: kycDocumentsBucket,
        Prefix: 'applications/',
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      const id = object.Key.replace(/^applications\//, '').replace(/\.json$/, '');
      const application = await getApplication(id);
      if (application && application.customer_id === customerId) {
        applications.push(application);
      }
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return applications;
}
