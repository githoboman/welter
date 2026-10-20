import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['scripts/frontend-build.mjs'], { cwd: root, stdio: 'inherit' });

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

const frontendRoot = path.resolve(root, 'frontend/public');
const evidenceRoot = path.resolve(frontendRoot, 'evidence');

function isWithinRoot(candidate, allowedRoot) {
  const relative = path.relative(allowedRoot, candidate);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function realPathWithinServedRoots(filePath) {
  const realPath = await fs.realpath(filePath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) return undefined;
  const realProjectRoot = await fs.realpath(root).catch(() => undefined);
  const realFrontendRoot = await fs.realpath(frontendRoot).catch(() => undefined);
  const realEvidenceRoot = await fs.realpath(evidenceRoot).catch(() => undefined);
  const frontendRootAllowed = Boolean(realProjectRoot && realFrontendRoot && isWithinRoot(realFrontendRoot, realProjectRoot));
  const evidenceRootAllowed = Boolean(realProjectRoot && realEvidenceRoot && isWithinRoot(realEvidenceRoot, realProjectRoot));
  if ((!frontendRootAllowed || !isWithinRoot(realPath, realFrontendRoot))
    && (!evidenceRootAllowed || !isWithinRoot(realPath, realEvidenceRoot))) return undefined;
  return realPath;
}

function safePath(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0]);
  } catch {
    return undefined;
  }

  // Reject ambiguous path forms before resolving them. In particular, do not
  // let a decoded traversal segment escape the explicitly served directories.
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return undefined;
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) return undefined;

  let relative;
  if (decoded === '/') {
    relative = path.join('frontend/public', 'index.html');
  } else if (decoded.startsWith('/evidence/')) {
    const evidenceName = decoded.slice('/evidence/'.length);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(evidenceName)) return undefined;
    relative = path.join('frontend/public/evidence', evidenceName);
  } else {
    const frontendPath = decoded.slice(1);
    if (!frontendPath) return path.join(frontendRoot, 'index.html');
    relative = path.join('frontend/public', frontendPath);
  }

  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (!fromRoot || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) return undefined;
  if (!fromRoot.startsWith(`frontend${path.sep}`) && !fromRoot.startsWith(`evidence${path.sep}`)) return undefined;
  return absolute;
}

const server = http.createServer(async (request, response) => {
  const requested = safePath(request.url ?? '/');
  if (!requested) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  let filePath = requested;
  try {
    await fs.access(filePath);
    filePath = await realPathWithinServedRoots(filePath);
    if (!filePath) throw new Error('requested file resolves outside served roots');
  } catch {
    const pathname = (request.url ?? '/').split('?')[0];
    if (pathname !== '/app' && !pathname.startsWith('/app/')) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    try {
      filePath = await realPathWithinServedRoots(path.join(frontendRoot, 'index.html'));
      if (!filePath) throw new Error('frontend entrypoint resolves outside served roots');
    } catch {
      response.writeHead(500);
      response.end('Frontend entrypoint unavailable');
      return;
    }
  }
  response.writeHead(200, {
    'Content-Type': mime.get(path.extname(filePath)) ?? 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  createReadStream(filePath).pipe(response);
});

const port = Number(process.env.PRIZERAIL_FRONTEND_PORT ?? 4173);
server.listen(port, '127.0.0.1', () => {
  console.log(`PrizeRail frontend running at http://127.0.0.1:${port}`);
});
