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
  message?: string;
  statusCode: number;
  data: T | null;
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
  action?: ApiAction;
  errors?: ApiFieldError[] | null;
  details?: Record<string, unknown> | null;
  timestamp: string;
  path: string;
  requestId: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface ApiPayload<T = unknown> {
  success?: true;
  message?: string;
  data?: T;
  meta?: Record<string, unknown> | null;
}
