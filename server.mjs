import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createTutor, ApiError } from './lib/tutor.mjs';
import { APP_VERSION, ValidationError } from './public/domain.mjs';

const publicRoot = new URL('./public/', import.meta.url);
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/domain.mjs', ['domain.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
export function createApp({ apiKey = '', model = 'gpt-5-mini', token = randomBytes(32).toString('hex'), fetcher, timeoutMs, onDiagnostic = event => console.info('[tutor]', JSON.stringify(event)) } = {}) {
  const tutor = createTutor({ apiKey, model, fetcher, timeoutMs, onDiagnostic });
  function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const host = `127.0.0.1:${server.address().port}`, origin = `http://${host}`;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
        return send(res, 403, { code: 'ORIGIN', message: '허용되지 않은 요청 출처입니다.' });
      }
      const path = req.url;
      if (path.startsWith('/api/')) {
        const auth = req.headers.authorization ?? '';
        const provided = Buffer.from(auth), expected = Buffer.from(`Bearer ${token}`);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(res, 401, { code: 'LOCAL_AUTH', message: '터미널에 표시된 접속 주소 전체를 다시 열어 주세요.' });
        if (req.method === 'GET' && path === '/api/status') return send(res, 200, { version: APP_VERSION, configured: Boolean(apiKey), model });
        if (req.method === 'POST' && path === '/api/tutor') {
          if (req.headers.origin !== origin) return send(res, 403, { code: 'ORIGIN', message: '요청 출처 확인에 실패했습니다.' });
          if (req.headers['content-type'] !== 'application/json') return send(res, 415, { code: 'CONTENT_TYPE', message: 'JSON 요청만 허용합니다.' });
          let size = 0; const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 150000) { send(res, 413, { code: 'INPUT_LIMIT', message: '요청이 150 KB를 넘습니다.' }); req.resume(); return; }
            chunks.push(chunk);
          }
          let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { code: 'JSON', message: '요청 JSON을 읽을 수 없습니다.' }); }
          return send(res, 200, await tutor.call(body));
        }
        return send(res, 404, { code: 'NOT_FOUND', message: '지원하지 않는 API입니다.' });
      }
      const asset = ASSETS.get(path);
      if (!asset || req.method !== 'GET') return send(res, 404, { code: 'NOT_FOUND', message: '페이지를 찾을 수 없습니다.' });
      send(res, 200, await readFile(new URL(asset[0], publicRoot)), asset[1]);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof ApiError) send(res, error.status, { code: error.code, message: error.message, stage: error.stage ?? 'local_validation' });
      else if (error instanceof ValidationError) send(res, 400, { code: 'VALIDATION', message: error.message });
      else send(res, 500, { code: 'INTERNAL', message: '요청을 처리하지 못했습니다. 현재 작업을 저장해 주세요.' });
      // Never log headers, request payloads, API keys, or raw upstream errors.
    }
  });
  server.requestTimeout = 75000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return { server, token };
}
async function maskedKey() {
  if (!process.stdin.isTTY) throw new Error('대화형 터미널에서 실행하거나 --offline을 지정하세요.');
  process.stdout.write('OpenAI API 키 (입력 숨김, Enter만 누르면 오프라인): ');
  return new Promise(resolveKey => {
    let key = ''; const input = process.stdin;
    input.setRawMode(true); input.resume(); input.setEncoding('utf8');
    function end() { input.setRawMode(false); input.pause(); input.removeListener('data', onData); process.stdout.write('\n'); }
    function onData(text) {
      for (const char of text) {
        if (char === '\u0003') { end(); process.exit(0); }
        if (char === '\r' || char === '\n') { end(); resolveKey(key.trim()); return; }
        if (char === '\u007f' || char === '\b') key = key.slice(0, -1);
        else if (char >= ' ' && char <= '~' && key.length < 512) key += char;
      }
    }
    input.on('data', onData);
  });
}
async function main() {
  const args = process.argv.slice(2); let offline = false, port = 3210, model = 'gpt-5-mini';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--offline') offline = true;
    else if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i] === '--model') model = args[++i];
    else if (args[i] === '--help') { console.log('node server.mjs [--offline] [--port 3210] [--model gpt-5-mini]\nAPI 키는 시작 시 숨김 입력합니다. 키를 명령행이나 파일에 넣지 마세요.'); return; }
    else throw new Error('알 수 없는 옵션입니다. --help로 사용법을 확인하세요.');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('포트 또는 모델명 형식을 확인하세요.');
  const apiKey = offline ? '' : await maskedKey();
  const { server, token } = createApp({ apiKey, model });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '포트가 사용 중입니다. --port 옵션으로 다른 포트를 선택하세요.' : '로컬 서버를 시작하지 못했습니다.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\nC / LAB · C17 Learning Workspace\n${apiKey ? 'API 키 설정됨 · 첫 요청 시 연결 확인' : '오프라인 · 모의 학습 사용 가능'}\n브라우저에서 아래 주소 전체를 여세요 (접속 토큰 포함):\nhttp://127.0.0.1:${port}/#token=${token}\n\n종료: Ctrl+C · 종료 전에 JSON을 저장하세요.\n`);
  });
  process.on('SIGINT', () => { server.close(); server.closeAllConnections(); process.exit(0); });
  process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); process.exit(0); });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('시작 설정을 확인하세요. 대화형 터미널을 사용하거나 node server.mjs --offline으로 실행하세요.'); process.exitCode = 1; });
