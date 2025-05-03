# kyc-service

Somos risk. Este servicio hace el onboarding de personas: recibe el documento que sube el
cliente, lo manda a verificar y le pone (o le saca) el semáforo de KYC en `ledger-core`.
Nada más. Si buscás altas de cuenta o transferencias, eso vive en otro lado.

## Qué hace, en un diagrama

```
cliente (mobile-bff)
      │  POST /v1/kyc/applications  {customer_id, document_base64, document_type}
      ▼
kyc-service
      │
      ├─► S3 (kyc-documents)          PutObject  <customer_id>/<uuid>.jpg
      │
      ├─► Veridoc  POST /v1/verify    {customer_id, document_url}
      │        └─► {result: approved|rejected|manual_review, reference}
      │
      ├─► ledger-core  PATCH /v1/customers/{id}/kyc-status
      │
      ├─► SQS <prefix>kyc-events      {"type":"kyc.decided", customer_id, status}
      │
      └─► S3 (kyc-documents)          applications/<id>.json   (nuestro "registro")
```

`GET /v1/kyc/applications/{id}` y `GET /v1/kyc/customers/{customer_id}/applications` leen
ese mismo bucket.

## Por qué S3 y no una base

Porque son tres campos (`status`, `document_url`, `provider_reference`) y un timestamp.
No queríamos otra base para eso — ya tenemos que operar Postgres para ledger, payments,
cards y rates, y sumar una más para esto nos pareció ridículo. S3 nos da persistencia,
versionado si lo prendemos algún día, y no depende de que nadie corra migraciones. El
trade-off es el que ya conocemos: no hay queries, así que `GET .../customers/{id}/applications`
lista el prefijo `applications/` entero y filtra en memoria. Con el volumen de KYC que
tenemos hoy no es un problema; si esto se convierte en el servicio de mayor tráfico del
sistema, ahí sí lo repensamos.

## Cómo correr local

```bash
npm install
npm test
npm run dev     # tsx watch, necesita las env vars de abajo apuntando a algo real o a mocks
```

Variables de entorno (todas obligatorias salvo que se indique lo contrario):

| Variable | Ejemplo |
|---|---|
| `SERVICE_NAME` | `kyc-service` |
| `ENV` | `staging` |
| `PORT` | `8080` |
| `LOG_LEVEL` | `info` |
| `KEYCLOAK_ISSUER` | `http://keycloak.platform.svc:8080/realms/cauri-staging` |
| `KEYCLOAK_CLIENT_ID` | `kyc-service` |
| `KEYCLOAK_CLIENT_SECRET` | (secret) |
| `AWS_ENDPOINT_URL` | `http://localstack.platform.svc:4566` |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | (secret) |
| `S3_BUCKET_PREFIX` | `cauri-staging-` |
| `SQS_QUEUE_PREFIX` | `staging-` |
| `VERIDOC_URL` | `http://sandbox.veridoc-id.com` |
| `VERIDOC_API_KEY` | (secret) |
| `LEDGER_CORE_URL` | `http://ledger-core:8080` |

## Deploy

Argo CD + Kustomize (estilo D). `deploy/base` tiene el Deployment (1 réplica, probes en
`/health`), Service, ServiceMonitor y el ConfigMap generado desde `deploy/base/config.yaml`.
Los overlays de `deploy/overlays/{staging,prod}` pisan namespace, issuer de Keycloak y la
URL de Veridoc (sandbox en staging, live en prod).

`build.yml` buildea la imagen, la pushea a `ghcr.io/demo-org-np-migration/kyc-service` y
hace `kustomize edit set image` sobre el overlay de staging, comiteando el cambio a este
mismo repo. Argo lo levanta de ahí. Un tag `v*` hace lo mismo contra el overlay de prod.
`ci.yml` corre los tests y valida que ambos overlays rendericen en cada PR.

## Usamos `@cauri/commons`

Auth de JWT (`createJwtAuth().fastify()`), logger, `httpClient` + `serviceTokenProvider`
para hablar con `ledger-core` con token de servicio del client `kyc-service`. Para
`/metrics` reusamos el `registry` de `metrics()` de la lib, pero servido a mano: el
`handler()` que trae la lib está pensado para Express y nosotros somos Fastify, así que el
wiring de la ruta lo hacemos nosotros (ver `src/metrics.ts`).

## TODO

Alguien consume `kyc-events`? Lo venimos publicando desde que existe este servicio
("alguien de marketing lo va a querer" fue el argumento original) pero nunca vi un
consumer registrado en ningún repo. Si estás leyendo esto y sabés quién lo lee, avisen en
`#platform-questions` antes de que alguien decida borrar la cola pensando que no la usa
nadie.

— Nicolás
