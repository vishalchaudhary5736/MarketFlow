import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../../../../generated/prisma/client';
import { ApiErrorResponse, ApiFieldError } from './api-response.interface';
import { resolveRequestId } from './request-context';

/** Fallback `code` when a thrown exception did not name one. */
const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.GONE]: 'GONE',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
  [HttpStatus.BAD_GATEWAY]: 'BAD_GATEWAY',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  [HttpStatus.GATEWAY_TIMEOUT]: 'GATEWAY_TIMEOUT',
};

/** Keys the envelope owns; anything else an exception carried becomes `details`. */
const RESERVED_KEYS = new Set([
  'success',
  'statusCode',
  'status',
  'code',
  'message',
  'action',
  'errors',
  'details',
  'error',
  'timestamp',
  'path',
  'requestId',
]);

/** Compared against plain numbers, so it is widened out of the enum type. */
const SERVER_ERROR: number = HttpStatus.INTERNAL_SERVER_ERROR;

const GENERIC_MESSAGE =
  'Something went wrong on our end. Please try again in a moment.';

/**
 * The single exit for every failure — thrown `HttpException`s, Prisma errors,
 * and anything else that escapes a handler. Whatever went wrong, the client
 * reads the same keys.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { statusCode, code, message, action, errors, details } =
      this.describe(exception);

    // 5xx is ours to fix, so it is logged with a stack; 4xx is the caller's
    // and would only be noise at error level.
    if (statusCode >= SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.originalUrl ?? req.url} -> ${statusCode} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.originalUrl ?? req.url} -> ${statusCode} ${code}`,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      statusCode,
      code,
      message,
      action,
      errors: errors ?? null,
      details: details ?? null,
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      requestId: resolveRequestId(req, res),
    };

    if (res.headersSent) {
      return;
    }

    res.status(statusCode).json(body);
  }

  private describe(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    action?: string;
    errors?: ApiFieldError[] | null;
    details?: Record<string, unknown> | null;
  } {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_REQUEST_DATA',
        message: 'The data sent with this request is not valid.',
        action: 'RETRY',
      };
    }

    // Anything unrecognised: the details stay in the log, not in the response.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: GENERIC_MESSAGE,
      action: 'RETRY',
    };
  }

  private fromHttpException(exception: HttpException) {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const fallbackCode = CODE_BY_STATUS[statusCode] ?? 'ERROR';

    if (typeof payload === 'string') {
      return {
        statusCode,
        code: fallbackCode,
        message: payload,
      };
    }

    const body = (payload ?? {}) as Record<string, unknown>;

    // ValidationPipe's default shape is `message: string[]`; the custom factory
    // in validation-exception.factory.ts sends field-level `errors` instead.
    const rawMessage = body.message;
    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : Array.isArray(rawMessage)
          ? String(rawMessage[0] ?? exception.message)
          : exception.message;

    const details = Object.fromEntries(
      Object.entries(body).filter(([key]) => !RESERVED_KEYS.has(key)),
    );

    return {
      statusCode,
      code: typeof body.code === 'string' ? body.code : fallbackCode,
      message,
      action: typeof body.action === 'string' ? body.action : undefined,
      errors: this.readFieldErrors(body, rawMessage),
      details: Object.keys(details).length > 0 ? details : null,
    };
  }

  private readFieldErrors(
    body: Record<string, unknown>,
    rawMessage: unknown,
  ): ApiFieldError[] | null {
    if (Array.isArray(body.errors)) {
      return body.errors as ApiFieldError[];
    }

    // Default ValidationPipe output: messages with no field attached.
    if (Array.isArray(rawMessage) && rawMessage.length > 0) {
      return [{ field: '_', messages: rawMessage.map(String) }];
    }

    return null;
  }

  /**
   * A Prisma error that reached here was not translated by the service, so it
   * is mapped generically — never by echoing the driver's message, which names
   * tables and columns.
   */
  private fromPrismaError(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': {
        const columns = (exception.meta?.target as string[] | undefined) ?? [];
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'ALREADY_EXISTS',
          message: 'A record with these details already exists.',
          action: 'SIGN_IN',
          details: columns.length ? { fields: columns } : null,
        };
      }
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'The requested record no longer exists.',
          action: 'RETRY',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'RELATED_RECORD_CONFLICT',
          message: 'This action conflicts with related records.',
          action: 'RETRY',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'INTERNAL_ERROR',
          message: GENERIC_MESSAGE,
          action: 'RETRY',
        };
    }
  }
}
