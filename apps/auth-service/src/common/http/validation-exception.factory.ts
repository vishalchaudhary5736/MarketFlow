import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ApiFieldError } from './api-response.interface';

/**
 * Turns ValidationPipe's errors into the envelope's `errors` array, keeping
 * the field name. The default pipe flattens everything into strings, which
 * leaves the client guessing which input to highlight.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const fieldErrors = flatten(errors);

  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    message:
      fieldErrors[0]?.messages[0] ??
      'Some of the details you entered are not valid.',
    action: 'RETRY',
    errors: fieldErrors,
  });
}

// Nested objects report as `address.city`, so the client can address the same
// path it sent.
function flatten(errors: ValidationError[], parent = ''): ApiFieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});
    const own: ApiFieldError[] = messages.length ? [{ field, messages }] : [];

    return [...own, ...flatten(error.children ?? [], field)];
  });
}
