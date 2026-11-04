import { Socket } from 'node:net';

/**
 * Checks MongoDB and Redis are reachable before Nest starts, so a stopped
 * service gives one clear message instead of endless reconnect stack traces.
 * Only plain host:port URLs are probed; Atlas `mongodb+srv://` is left to the driver.
 */
function reachable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function target(url: string | undefined, defaultPort: number): { host: string; port: number } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'mongodb+srv:') return null;
    // A mongodb:// URL may list several hosts; probing the first is enough for a local setup.
    const host = u.hostname.split(',')[0];
    return { host, port: Number(u.port || defaultPort) };
  } catch {
    return null;
  }
}

export async function preflight(): Promise<void> {
  const checks = [
    {
      name: 'MongoDB',
      env: 'MONGODB_URI',
      t: target(process.env.MONGODB_URI, 27017),
      hint: 'Start it (mongod --dbpath /opt/homebrew/var/mongodb) or set MONGODB_URI to your Atlas connection string.',
    },
    {
      name: 'Redis',
      env: 'REDIS_URL',
      t: target(process.env.REDIS_URL, 6379),
      hint: 'Start it (brew services start redis) or set REDIS_URL to a hosted Redis.',
    },
  ];
  const failed: string[] = [];
  for (const c of checks) {
    if (c.t && !(await reachable(c.t.host, c.t.port))) {
      failed.push(`  ✗ ${c.name} is not reachable at ${c.t.host}:${c.t.port} (${c.env}). ${c.hint}`);
    }
  }
  if (failed.length) {
    console.error(`\nAdsAssist API cannot start:\n${failed.join('\n')}\n`);
    process.exit(1);
  }
}
