import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { ApiPayload, ApiSuccessResponse } from './api-response.interface';
import { resolveRequestId } from './request-context';
import {
  RESPONSE_MESSAGE,
  SKIP_RESPONSE_ENVELOPE,
} from './response-message.decorator';

const DEFAULT_MESSAGE = 'Request completed successfully.';

/**
 * Wraps every successful handler return in the response envelope.
 *
 * Handlers may keep returning `{ success, message, data }` — that shape is
 * lifted into the envelope rather than nested inside it. Anything else becomes
 * `data` as-is, with the message coming from `@ResponseMessage()`.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, unknown> {
  private readonly logger = new Logger(ResponseInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_ENVELOPE,
      [context.getHandler(), context.getClass()],
    );

    if (skip) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = resolveRequestId(req, res);

    const declaredMessage = this.reflector.getAllAndOverride<string>(
      RESPONSE_MESSAGE,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      map((payload) => {
        // Binary and streamed bodies have no room for an envelope.
        if (payload instanceof StreamableFile || Buffer.isBuffer(payload)) {
          return payload;
        }

        const { message, data, meta } = this.unwrap(payload, declaredMessage);

        return {
          success: true,
          statusCode: res.statusCode,
          message,
          data,
          meta: meta ?? null,
          timestamp: new Date().toISOString(),
          path: req.originalUrl ?? req.url,
          requestId,
        } satisfies ApiSuccessResponse;
      }),
    );
  }

  /**
   * Distinguishes a handler that returned an envelope-shaped object from one
   * that returned a domain object which happens to have a `data` field.
   */
  private unwrap(
    payload: unknown,
    declaredMessage?: string,
  ): { message: string; data: unknown; meta?: Record<string, unknown> | null } {
    const isEnvelopeShaped =
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof (payload as ApiPayload).success === 'boolean';

    if (!isEnvelopeShaped) {
      return {
        message: declaredMessage ?? DEFAULT_MESSAGE,
        data: payload ?? null,
      };
    }

    const { message, data, meta } = payload as ApiPayload;

    // The envelope always says `success: true` here, so a handler that
    // returned `success: false` would mislead the client. Failures must be
    // thrown as HttpExceptions instead (see ApiPayload).
    if ((payload as { success: boolean }).success === false) {
      this.logger.error(
        `Handler returned success: false ("${message}"); it was sent as success: true. Throw an HttpException instead.`,
      );
    }

    return {
      message: message ?? declaredMessage ?? DEFAULT_MESSAGE,
      data: data ?? null,
      meta: meta ?? null,
    };
  }
}
