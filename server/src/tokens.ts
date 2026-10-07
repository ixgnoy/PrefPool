// server/src/tokens.ts
import { randomHex32, sha256Hex } from '@as/shared';

export const newToken = (): string => randomHex32();
export const hashToken = (token: string): string => sha256Hex(`agent-survey-token:${token}`);
