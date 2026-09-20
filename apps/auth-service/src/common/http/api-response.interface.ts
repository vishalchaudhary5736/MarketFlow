/**
 * The single shape every HTTP response leaves this service in — success or
 * failure. The client can branch on `success` alone and trust that every other
 * field is in the place it expects.
 */

/** Machine-readable reason, stable across wording changes. Clients switch on this. */
export type ApiErrorCode = string;

/** What the client should offer the person next: 'SIGN_IN', 'RESEND_OTP', 'RETRY', … */
export type ApiAction = string;

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  statusCode: number;
  /** Human-readable and safe to show as-is. */
  message: string;
  /** The payload. `null` rather than absent, so the key is always there. */
  data: T | null;
  /** Pagination, counts, anything about the payload rather than in it. */
  meta?: Record<string, unknown> | null;
  timestamp: string;
  path: string;
  requestId: string;
}

/** One rejected field. Only ever populated by validation failures. */
export interface ApiFieldError {
  field: string;
  messages: string[];
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  /** Present whenever the server knows what the client should offer next. */
  action?: ApiAction;
  /** Field-level detail for form errors; `null` when the failure is not per-field. */
  errors?: ApiFieldError[] | null;
  /** Extra context tied to the code — `field`, `attemptsRemaining`, … */
  details?: Record<string, unknown> | null;
  timestamp: string;
  path: string;
  requestId: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * What a service/controller may return to steer the envelope. Anything else it
 * returns is treated as `data` wholesale, so existing handlers keep working.
 */
export interface ApiPayload<T = unknown> {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: Record<string, unknown> | null;
}
