import { createJwtAuth } from '@cauri/commons';
import { config } from './config';

export const auth = createJwtAuth({ issuer: config.keycloakIssuer });
