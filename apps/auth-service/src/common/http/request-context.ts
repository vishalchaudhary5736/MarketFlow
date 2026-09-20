import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export function resolveRequestId(req: Request, res?: Response): string {
  const incoming = req?.headers?.[REQUEST_ID_HEADER];
  const existing = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = existing?.trim() || randomUUID();

  if (res && !res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, requestId);
  }

  return requestId;
}
