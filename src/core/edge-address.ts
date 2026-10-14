/**
 * The origin of the Edge address that the owner enters: `https://host[:port]`. It throws for an
 * address that is not HTTPS or that carries a user name or a password.
 */
export function edgeOrigin(address: string): string {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new Error('the Edge address is not a valid address');
  }
  if (url.protocol !== 'https:') {
    throw new Error('the Edge address must start with https://');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('the Edge address must not contain a user name or a password');
  }
  return url.origin;
}
