// playtest-link relay — receives invoke bundles + asset feedback, stores them
// on disk, and (optionally) posts each one into a Discord channel.
//
// Config via env:
//   PTL_PORT           (default 4791)
//   PTL_INBOX          bundle dir  (default ./playtest-inbox)
//   PTL_FEEDBACK_LOG   feedback jsonl (default ./feedback.jsonl)
//   PTL_DISCORD_TOKEN  bot token   (optional — omit to disable Discord posts)
//   PTL_DISCORD_CHANNEL channel id (required if token set)
import { createServer } from 'http';
import { appendFileSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, existsSync, createReadStream } from 'fs';

const PORT = +(process.env.PTL_PORT || 4791);
const INBOX = process.env.PTL_INBOX || './playtest-inbox';
const LOG = process.env.PTL_FEEDBACK_LOG || './feedback.jsonl';
const TOKEN = process.env.PTL_DISCORD_TOKEN || null;
const CHANNEL = process.env.PTL_DISCORD_CHANNEL || null;

async function discordText(content) {
  if (!TOKEN || !CHANNEL) return;
  await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

async function discordWithFile(content, filename, buf) {
  if (!TOKEN || !CHANNEL) return;
  const boundary = '----ptl' + Date.now();
  const head = (name, extra) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${extra || ''}\r\n`;
  const parts = [
    Buffer.from(head('payload_json') + 'Content-Type: application/json\r\n\r\n' + JSON.stringify({ content }) + '\r\n'),
    Buffer.from(head('files[0]', `; filename="${filename}"`) + 'Content-Type: video/webm\r\n\r\n'),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(parts),
  });
}

const readBody = (req, cap) => new Promise((res, rej) => {
  let chunks = [], size = 0;
  req.on('data', (c) => { size += c.length; if (size > cap) { req.destroy(); rej(new Error('too big')); } else chunks.push(c); });
  req.on('end', () => res(Buffer.concat(chunks)));
  req.on('error', rej);
});

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (req.method === 'POST' && req.url.endsWith('/feedback')) {
      const { asset, title, text } = JSON.parse(await readBody(req, 8192));
      if (!asset || !text || String(text).length > 1200) throw new Error('bad payload');
      appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), asset, title, text: String(text) }) + '\n');
      await discordText(`🗂️ **asset feedback** · \`${asset}\` (${title})\n> ${String(text).slice(0, 900)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.method === 'POST' && req.url.endsWith('/invoke')) {
      const { meta, clips } = JSON.parse(await readBody(req, 40 * 1024 * 1024));
      if (!meta || !meta.game) throw new Error('bad payload');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = `${INBOX}/${String(meta.game).replace(/\W/g, '')}/${stamp}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 1));
      let biggest = null;
      (clips || []).forEach((b64, i) => {
        const buf = Buffer.from(b64, 'base64');
        writeFileSync(`${dir}/clip${i}.webm`, buf);
        if (!biggest || buf.length > biggest.buf.length) biggest = { buf, name: `clip${i}.webm` };
      });
      const zone = meta.snapshot?.zone || meta.snapshot?.room || '?';
      const line = `🎮 **playtest invoke** · \`${meta.game}\` · zone **${zone}** · ${meta.marks?.length || 0} marks\n` +
        `> ${String(meta.complaint).slice(0, 800)}\n` +
        (meta.aim ? `aim: \`${meta.aim}\`\n` : '') +
        `bundle: \`${dir}\``;
      if (biggest && biggest.buf.length < 9 * 1024 * 1024) await discordWithFile(line, biggest.name, biggest.buf);
      else await discordText(line + (biggest ? ' (clip too large to attach — on disk)' : ' (no clip)'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.method === 'GET' && req.url.match(/\/invokes$/)) {
      const out = [];
      if (existsSync(INBOX)) for (const game of readdirSync(INBOX)) {
        const gdir = `${INBOX}/${game}`;
        if (!statSync(gdir).isDirectory()) continue;
        for (const stamp of readdirSync(gdir)) {
          try {
            const meta = JSON.parse(readFileSync(`${gdir}/${stamp}/meta.json`, 'utf8'));
            const clips = readdirSync(`${gdir}/${stamp}`).filter((f) => f.endsWith('.webm'));
            out.push({ game, stamp, complaint: meta.complaint, zone: meta.snapshot?.zone || meta.snapshot?.room || '?',
              aim: meta.aim, marks: (meta.marks || []).length, events: (meta.events || []).length, clips });
          } catch {}
        }
      }
      out.sort((a, b) => b.stamp.localeCompare(a.stamp));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    if (req.method === 'GET' && req.url.includes('/files/')) {
      const rel = decodeURIComponent(req.url.split('/files/')[1] || '');
      if (rel.includes('..') || !/^[\w-]+\/[\w-]+\/[\w.-]+$/.test(rel)) { res.writeHead(400); return res.end(); }
      const path = `${INBOX}/${rel}`;
      if (!existsSync(path)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': rel.endsWith('.webm') ? 'video/webm' : 'application/json' });
      return createReadStream(path).pipe(res);
    }
    if (req.method === 'GET' && req.url.match(/\/feedbacklog$/)) {
      let rows = [];
      try { rows = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(rows.reverse()));
    }
    res.writeHead(404); res.end();
  } catch (e) {
    res.writeHead(400); res.end('{"ok":false}');
  }
}).listen(PORT, '127.0.0.1', () => console.log('playtest-link relay on', PORT));
