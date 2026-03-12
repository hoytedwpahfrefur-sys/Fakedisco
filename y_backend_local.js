const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DISCORD_API = 'https://discord.com/api/v10';

const session = {
  token: null,
  profile: null,
  guilds: []
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function safeFilePath(urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const joined = path.join(ROOT, rel);
  if (!joined.startsWith(ROOT)) return null;
  return joined;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function toAvatarUrl(id, avatarHash) {
  if (!id || !avatarHash) return '';
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.${ext}?size=256`;
}

function toGuildIconUrl(guildId, iconHash) {
  if (!guildId || !iconHash) return '';
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=128`;
}

async function discordGet(token, endpoint) {
  const res = await fetch(`${DISCORD_API}${endpoint}`, {
    headers: { Authorization: `Bot ${token}` }
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { message: text || 'Discord returned invalid JSON.' };
  }
  if (!res.ok) {
    const error = new Error(json.message || `Discord API failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return json;
}


function toMessageAuthor(m) {
  const isBot = Boolean(m.author?.bot);
  return {
    id: m.author?.id || '',
    n: m.author?.global_name || m.author?.username || 'Unknown',
    c: isBot ? '#5865F2' : '#57F287',
    bot: isBot,
    avatar_url: m.author?.id && m.author?.avatar ? toAvatarUrl(m.author.id, m.author.avatar) : ''
  };
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/session/start') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const token = String(body.token || '').trim();
    if (!token) return sendJson(res, 400, { ok: false, error: 'Token is required.' });

    try {
      const me = await discordGet(token, '/users/@me');
      const guilds = await discordGet(token, '/users/@me/guilds');
      session.token = token;
      session.profile = {
        id: me.id,
        username: me.username,
        global_name: me.global_name || '',
        discriminator: me.discriminator,
        avatar_url: toAvatarUrl(me.id, me.avatar)
      };
      session.guilds = Array.isArray(guilds) ? guilds : [];
      return sendJson(res, 200, { ok: true, profile: session.profile, guild_count: session.guilds.length });
    } catch (err) {
      if (err.status === 401) return sendJson(res, 401, { ok: false, error: 'Invalid bot token.' });
      return sendJson(res, 502, { ok: false, error: err.message || 'Could not reach Discord.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/session/status') {
    if (!session.token || !session.profile) return sendJson(res, 200, { active: false });
    return sendJson(res, 200, {
      active: true,
      profile: session.profile,
      guild_count: session.guilds.length
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/session/logout') {
    session.token = null;
    session.profile = null;
    session.guilds = [];
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/guilds') {
    if (!session.token) return sendJson(res, 401, { error: 'Not logged in.' });
    try {
      const guilds = await discordGet(session.token, '/users/@me/guilds');
      session.guilds = Array.isArray(guilds) ? guilds : [];
      return sendJson(res, 200, {
        guilds: session.guilds.map((g) => ({ id: g.id, name: g.name, icon_url: toGuildIconUrl(g.id, g.icon) }))
      });
    } catch (err) {
      return sendJson(res, 502, { error: err.message || 'Failed to fetch guilds.' });
    }
  }

  if (req.method === 'GET' && /^\/api\/guilds\/[^/]+\/channels$/.test(url.pathname)) {
    if (!session.token) return sendJson(res, 401, { error: 'Not logged in.' });
    const guildId = url.pathname.split('/')[3];
    try {
      const channels = await discordGet(session.token, `/guilds/${guildId}/channels`);
      return sendJson(res, 200, { channels: Array.isArray(channels) ? channels : [] });
    } catch (err) {
      return sendJson(res, 502, { error: err.message || 'Failed to fetch channels.' });
    }
  }


  if (req.method === 'GET' && /^\/api\/channels\/[^/]+\/messages$/.test(url.pathname)) {
    if (!session.token) return sendJson(res, 401, { error: 'Not logged in.' });
    const channelId = url.pathname.split('/')[3];
    const limitRaw = Number(url.searchParams.get('limit') || 30);
    const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 30));

    try {
      const messages = await discordGet(session.token, `/channels/${channelId}/messages?limit=${limit}`);
      const clean = (Array.isArray(messages) ? messages : [])
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          a: toMessageAuthor(m),
          content: m.content || '',
          ts: new Date(m.timestamp).getTime(),
          embed: Array.isArray(m.embeds) && m.embeds.length ? {
            color: m.embeds[0].color || 0x5865F2,
            title: m.embeds[0].title || '',
            desc: m.embeds[0].description || ''
          } : undefined
        }));
      return sendJson(res, 200, { messages: clean });
    } catch (err) {
      return sendJson(res, 502, { error: err.message || 'Failed to fetch messages.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/messages/send') {
    if (!session.token) return sendJson(res, 401, { error: 'Not logged in.' });
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const channelId = String(body.channel_id || '').trim();
    const content = String(body.content || '').trim();
    if (!channelId || !content) return sendJson(res, 400, { error: 'channel_id and content are required.' });

    try {
      const msg = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${session.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
      });
      const data = await msg.json().catch(() => ({}));
      if (!msg.ok) return sendJson(res, msg.status, { error: data.message || 'Discord rejected the message.' });
      return sendJson(res, 200, { ok: true, message_id: data.id });
    } catch (err) {
      return sendJson(res, 502, { error: err.message || 'Failed to send message.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/console/run') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const command = String(body.command || '').trim();
    if (!command) return sendJson(res, 400, { error: 'Command is required.' });

    exec(command, { timeout: 10000, maxBuffer: 1024 * 200 }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim().slice(0, 4000);
      if (error) return sendJson(res, 200, { exit_code: error.code || 1, output: output || error.message });
      return sendJson(res, 200, { exit_code: 0, output: output || '(no output)' });
    });
    return;
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url);
  }

  const filePath = safeFilePath(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Biscord local backend running on http://localhost:${PORT}`);
});
