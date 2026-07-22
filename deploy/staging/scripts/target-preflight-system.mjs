import { promises as dns } from 'node:dns';
import { readFile, statfs } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { arch, cpus, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect as tlsConnect } from 'node:tls';

import { TargetPreflightError } from './target-preflight.mjs';

export function createSystemPreflightAdapter({ stagingRoot, tlsRoot }) {
  const caPath = join(tlsRoot, 'ca.crt');
  const redisPasswordPath = join(stagingRoot, '.secrets', 'redis_password');

  return {
    async hostResources() {
      const filesystem = await statfs(stagingRoot, { bigint: true });
      return {
        platform: platform(),
        architecture: arch(),
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        availableDiskBytes: Number(filesystem.bavail * filesystem.bsize),
      };
    },
    async dockerVersion() {
      return command('docker', ['version', '--format', '{{.Server.Version}}'], 'TARGET_DOCKER_UNAVAILABLE');
    },
    async composeVersion() {
      return command('docker', ['compose', 'version', '--short'], 'TARGET_COMPOSE_UNAVAILABLE').replace(/^v/, '');
    },
    async clockStatus() {
      const synchronized = command(
        'timedatectl',
        ['show', '--property=NTPSynchronized', '--value'],
        'TARGET_CLOCK_STATUS_UNAVAILABLE',
      );
      return { synchronized: synchronized === 'yes', sourceClass: 'systemd-timesync' };
    },
    async dns(hostname) {
      try {
        return await dns.lookup(hostname, { all: true, verbatim: true });
      } catch {
        throw new TargetPreflightError('TARGET_DNS_LOOKUP_FAILED');
      }
    },
    async tcp(hostname, port, timeoutMs) {
      return socketOperation({ hostname, port, timeoutMs }, (socket, resolve) => {
        resolve({ connected: true });
        socket.end();
      }, 'TARGET_TCP_UNREACHABLE');
    },
    async tls(hostname, port, timeoutMs) {
      const ca = await readCa(caPath);
      return new Promise((resolve, reject) => {
        const socket = tlsConnect({ host: hostname, port, servername: hostname, ca, rejectUnauthorized: true });
        const timeout = setTimeout(() => socket.destroy(new Error('timeout')), timeoutMs);
        socket.once('secureConnect', () => {
          clearTimeout(timeout);
          const certificate = socket.getPeerCertificate();
          resolve({
            authorized: socket.authorized,
            protocol: socket.getProtocol() ?? 'unknown',
            validTo: certificate.valid_to,
            fingerprint: certificate.fingerprint256 ?? '',
          });
          socket.end();
        });
        socket.once('error', () => {
          clearTimeout(timeout);
          reject(new TargetPreflightError('TARGET_TLS_CONNECTION_FAILED'));
        });
      });
    },
    async registry(registryHost, timeoutMs) {
      return httpsStatus(new URL(`https://${registryHost}/v2/`), await readCa(caPath), timeoutMs);
    },
    async postgresTls(hostname, port, servername, timeoutMs) {
      const ca = await readCa(caPath);
      return new Promise((resolve, reject) => {
        const socket = netConnect({ host: hostname, port });
        const timeout = setTimeout(() => socket.destroy(new Error('timeout')), timeoutMs);
        socket.once('connect', () => {
          const request = Buffer.alloc(8);
          request.writeInt32BE(8, 0);
          request.writeInt32BE(80_877_103, 4);
          socket.write(request);
        });
        socket.once('data', (chunk) => {
          if (chunk[0] !== 0x53) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new TargetPreflightError('TARGET_POSTGRES_TLS_REQUIRED'));
            return;
          }
          socket.removeAllListeners('error');
          const secureSocket = tlsConnect({ socket, servername, ca, rejectUnauthorized: true });
          secureSocket.once('secureConnect', () => {
            clearTimeout(timeout);
            resolve({ tls: secureSocket.authorized, protocol: secureSocket.getProtocol() ?? 'unknown' });
            secureSocket.end();
          });
          secureSocket.once('error', () => {
            clearTimeout(timeout);
            reject(new TargetPreflightError('TARGET_POSTGRES_TLS_HANDSHAKE_FAILED'));
          });
        });
        socket.once('error', () => {
          clearTimeout(timeout);
          reject(new TargetPreflightError('TARGET_POSTGRES_UNREACHABLE'));
        });
      });
    },
    async redisPing(hostname, port, username, timeoutMs) {
      let password;
      try {
        password = (await readFile(redisPasswordPath, 'utf8')).trim();
      } catch {
        throw new TargetPreflightError('TARGET_REDIS_SECRET_MISSING', 'blocked_external');
      }
      if (!password) throw new TargetPreflightError('TARGET_REDIS_SECRET_MISSING', 'blocked_external');
      const auth = username ? resp(['AUTH', username, password]) : resp(['AUTH', password]);
      const payload = Buffer.concat([auth, resp(['PING'])]);
      return new Promise((resolve, reject) => {
        const socket = netConnect({ host: hostname, port });
        const chunks = [];
        const timeout = setTimeout(() => socket.destroy(new Error('timeout')), timeoutMs);
        socket.once('connect', () => socket.write(payload));
        socket.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
          const response = Buffer.concat(chunks).toString('utf8');
          if (response.includes('+OK\r\n') && response.includes('+PONG\r\n')) {
            clearTimeout(timeout);
            resolve({ authenticated: true, pong: true });
            socket.end();
          } else if (response.includes('-ERR') || response.includes('-WRONGPASS')) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new TargetPreflightError('TARGET_REDIS_AUTH_PING_FAILED'));
          }
        });
        socket.once('error', () => {
          clearTimeout(timeout);
          reject(new TargetPreflightError('TARGET_REDIS_UNREACHABLE'));
        });
      });
    },
    async http(url, timeoutMs) {
      return httpsStatus(new URL(url), await readCa(caPath), timeoutMs);
    },
    async clamavPing(hostname, port, timeoutMs) {
      return new Promise((resolve, reject) => {
        const socket = netConnect({ host: hostname, port });
        const timeout = setTimeout(() => socket.destroy(new Error('timeout')), timeoutMs);
        socket.once('connect', () => socket.write('zPING\0'));
        socket.once('data', (chunk) => {
          clearTimeout(timeout);
          const pong = chunk.toString('utf8').replace(/\0/g, '').trim() === 'PONG';
          if (pong) resolve({ pong: true });
          else reject(new TargetPreflightError('TARGET_CLAMAV_PING_FAILED'));
          socket.end();
        });
        socket.once('error', () => {
          clearTimeout(timeout);
          reject(new TargetPreflightError('TARGET_CLAMAV_UNREACHABLE'));
        });
      });
    },
  };
}

function command(name, arguments_, errorCode) {
  const result = spawnSync(name, arguments_, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    windowsHide: true,
  });
  const output = String(result.stdout ?? '').trim();
  if (result.status !== 0 || !output) throw new TargetPreflightError(errorCode);
  return output;
}

function socketOperation(options, onConnect, errorCode) {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: options.hostname, port: options.port });
    const timeout = setTimeout(() => socket.destroy(new Error('timeout')), options.timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timeout);
      onConnect(socket, resolve);
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      reject(new TargetPreflightError(errorCode));
    });
  });
}

function httpsStatus(url, ca, timeoutMs) {
  return new Promise((resolve, reject) => {
    const operation = httpsRequest(url, {
      method: 'GET',
      ca,
      rejectUnauthorized: true,
      headers: { Accept: 'application/json' },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve({ statusCode: response.statusCode ?? 0 }));
    });
    operation.setTimeout(timeoutMs, () => operation.destroy(new Error('timeout')));
    operation.once('error', () => reject(new TargetPreflightError('TARGET_HTTPS_PROBE_FAILED')));
    operation.end();
  });
}

async function readCa(path) {
  try {
    return await readFile(path);
  } catch {
    throw new TargetPreflightError('TARGET_CA_FILE_MISSING', 'blocked_external');
  }
}

function resp(parts) {
  return Buffer.from(`*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`);
}
