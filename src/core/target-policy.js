const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function assertAuthorizedTarget(rawUrl) {
  const target = new URL(rawUrl);
  const host = target.hostname.toLowerCase();
  const allowed = LOOPBACK_HOSTS.has(host) || host.endsWith('.test');
  if (!allowed) {
    throw new Error(`Target blocked by lab policy: ${host}. Use localhost, loopback, or an owned .test host.`);
  }
  return target;
}
