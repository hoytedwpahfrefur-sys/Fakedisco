#!/usr/bin/env node

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const API_BASE = 'https://discord.com/api/v10';
const BASE_DIR = __dirname;

const STATIC_ROUTES = {
  '/': 'index.html',
  '/login': 'index.html',
  '/index.html': 'index.html',
  '/permissions': 'y_perm.html',
  '/dashboard': 'y_bot-dashboard2.html',
  '/y_login2.html': 'y_login2.html',
  '/y_perm.html': 'y_perm.html',
  '/y_bot-dashboard2.html': 'y_bot-dashboard2.html',
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const STATE = {
  token: null,
  profile: null,
  guild_count: 0,
};

function jsonResponse(res, code, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function requireSession() {
  if (!STATE.token) {
    const err = new Error('No active bot session');
    err.statusCode = 401;
    throw err;
  }
  return STATE.token;
}

function discordRequest(method, apiPath, token, payload) {
  const target = new URL(API_BASE + apiPath);
  const body = payload ? Buffer.from(JSON.stringify(payload)) : null;

  const options = {
    method,
    hostname: target.hostname,
    path: target.pathname + target.search,
    headers: {
      Authorization: `Bot ${token}`,
      'User-Agent': 'BiscordLocalBackend/1.0',
    },
    timeout: 15000,
  };

  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = body.length;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (resp) => {
      let raw = '';
      resp.setEncoding('utf8');
      resp.on('data', (chunk) => {
        raw += chunk;
      });
      resp.on('end', () => {
        const statusCode = resp.statusCode || 500;
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }

        if (statusCode >= 200 && statusCode < 300) {
          resolve(data);
          return;
        }

        const err = new Error('Discord API error');
        err.statusCode = statusCode;
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Could not reach Discord API'));
    });
    req.on('error', (err) => {
      const wrapped = new Error('Could not reach Discord API');
      wrapped.cause = err;
      reject(wrapped);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function avatarUrl(profile) {
  const avatar = profile.avatar;
  if (!avatar) {
    return '';
  }
  const ext = String(avatar).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${profile.id}/${avatar}.${ext}?size=128`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function resolveStaticFile(routePath) {
  const mapped = STATIC_ROUTES[routePath];
  if (mapped) {
    const mappedPath = path.join(BASE_DIR, mapped);
    return fs.existsSync(mappedPath) ? mappedPath : null;
  }

  const candidate = path.resolve(BASE_DIR, routePath.replace(/^\/+/, ''));
  if (!candidate.startsWith(BASE_DIR) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return null;
  }
  return candidate;
}

function serveStatic(res, routePath) {
  const safePath = decodeURIComponent(routePath.split('?')[0]);
  const filePath = resolveStaticFile(safePath);
  if (!filePath) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  const payload = fs.readFileSync(filePath);

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': payload.length,
  });
  res.end(payload);
  return true;
}

async function handleGet(req, res, routePath) {
  if (!routePath.startsWith('/api/')) {
    if (serveStatic(res, routePath)) {
      return;
    }
    jsonResponse(res, 404, { error: 'Not found' });
    return;
  }

  try {
    if (routePath === '/api/session/status') {
      jsonResponse(res, 200, {
        active: Boolean(STATE.token),
        profile: STATE.profile,
        guild_count: STATE.guild_count || 0,
      });
      return;
    }

    if (routePath === '/api/guilds') {
      const token = requireSession();
      const guilds = await discordRequest('GET', '/users/@me/guilds', token);
      jsonResponse(res, 200, { guilds });
      return;
    }

    if (routePath.startsWith('/api/guilds/') && routePath.endsWith('/channels')) {
      const token = requireSession();
      const guildId = routePath.split('/')[3];
      const channels = await discordRequest('GET', `/guilds/${guildId}/channels`, token);
      jsonResponse(res, 200, { channels });
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err.statusCode === 401) {
      jsonResponse(res, 401, { error: err.message });
      return;
    }
    if (err.statusCode) {
      jsonResponse(res, err.statusCode, { error: 'Discord API error' });
      return;
    }
    jsonResponse(res, 502, { error: 'Could not reach Discord API' });
  }
}

async function handlePost(req, res, routePath) {
  try {
    if (routePath === '/api/session/start') {
      const data = await readBody(req);
      const token = String(data.token || '').trim();
      if (!token) {
        jsonResponse(res, 400, { error: 'Token is required' });
        return;
      }

      STATE.token = token;
      const profile = await discordRequest('GET', '/users/@me', token);
      const guilds = await discordRequest('GET', '/users/@me/guilds', token);
      STATE.profile = {
        id: profile.id,
        username: profile.username,
        avatar_url: avatarUrl(profile),
      };
      STATE.guild_count = Array.isArray(guilds) ? guilds.length : 0;

      jsonResponse(res, 200, {
        ok: true,
        profile: STATE.profile,
        guild_count: STATE.guild_count,
      });
      return;
    }

    if (routePath === '/api/messages/send') {
      const token = requireSession();
      const data = await readBody(req);
      const channelId = String(data.channel_id || '').trim();
      const content = String(data.content || '').trim();
      if (!channelId || !content) {
        jsonResponse(res, 400, { error: 'channel_id and content are required' });
        return;
      }

      const message = await discordRequest('POST', `/channels/${channelId}/messages`, token, { content });
      jsonResponse(res, 200, { ok: true, message });
      return;
    }

    if (routePath === '/api/console/run') {
      requireSession();
      const data = await readBody(req);
      const command = String(data.command || '').trim();
      if (!command) {
        jsonResponse(res, 400, { error: 'command is required' });
        return;
      }

      exec(command, { timeout: 15000, maxBuffer: 2 * 1024 * 1024, shell: true }, (error, stdout, stderr) => {
        if (error && error.killed) {
          jsonResponse(res, 408, { error: 'Command timed out after 15s' });
          return;
        }
        const output = `${stdout || ''}${stderr || ''}`.trim();
        jsonResponse(res, 200, {
          ok: true,
          exit_code: error && typeof error.code === 'number' ? error.code : 0,
          output: (output || '(no output)').slice(0, 3500),
        });
      });
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (err) {
    STATE.token = null;
    STATE.profile = null;
    STATE.guild_count = 0;

    if (err.statusCode === 401) {
      jsonResponse(res, 401, { error: 'Invalid bot token' });
      return;
    }
    if (err.statusCode) {
      jsonResponse(res, err.statusCode, { error: 'Discord API error' });
      return;
    }
    jsonResponse(res, 502, { error: 'Could not reach Discord API' });
  }
}

const server = http.createServer(async (req, res) => {
  const routePath = req.url ? req.url.split('?')[0] : '/';

  if (req.method === 'OPTIONS') {
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET') {
    await handleGet(req, res, routePath);
    return;
  }

  if (req.method === 'POST') {
    await handlePost(req, res, routePath);
    return;
  }

  jsonResponse(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  console.log(`Biscord backend running on http://${HOST}:${PORT}`);
});
