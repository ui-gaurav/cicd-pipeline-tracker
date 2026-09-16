import crypto from 'crypto';

export function verifyGitHubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const hmac = crypto.createHmac('sha256', secret);
  const digest = `sha256=${hmac.update(rawBody).digest('hex')}`;

  const checksum = Buffer.from(digest, 'utf8');
  const signature = Buffer.from(signatureHeader, 'utf8');

  if (checksum.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(checksum, signature);
}