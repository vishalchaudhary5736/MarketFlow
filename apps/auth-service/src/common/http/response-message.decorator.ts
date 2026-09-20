import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE = 'response:message';

/**
 * The `message` the envelope carries when a handler returns plain data.
 *
 * Handlers that already return `{ success, message, data }` do not need it —
 * their own message wins.
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE, message);

export const SKIP_RESPONSE_ENVELOPE = 'response:skip-envelope';

/**
 * Opts a handler out of the envelope, for the rare response that is not JSON:
 * a file download, a redirect, a webhook that must echo a provider's format.
 */
export const SkipResponseEnvelope = () =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE, true);
