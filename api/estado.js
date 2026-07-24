// Estado compartilhado do app VIART 2026 (checklist, datas, orçamento realizado,
// presenças e entrega de kit). Guardado numa única chave do Redis da Vercel.
//
// Variáveis de ambiente esperadas (criadas automaticamente ao conectar o
// Marketplace Database "Upstash for Redis" no projeto da Vercel):
//   KV_REST_API_URL  /  KV_REST_API_TOKEN
// Aceita também os nomes UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
//
// GET  /api/estado           -> { ok: true, campos: { chave: { v, t } } }
// POST /api/estado           -> body { campos: { chave: { v, t } } } (merge por timestamp)

const CHAVE = 'viart2026:estado';

function credenciais() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redis(cmd) {
  const c = credenciais();
  if (!c) throw new Error('sem-banco');
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('redis-' + r.status);
  const j = await r.json();
  return j.result;
}

async function ler() {
  const bruto = await redis(['GET', CHAVE]);
  if (!bruto) return {};
  try { return JSON.parse(bruto).campos || {}; } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!credenciais()) {
    return res.status(200).json({ ok: false, erro: 'sem-banco', campos: {} });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, campos: await ler() });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const entrada = (body && body.campos) || {};
      const atual = await ler();
      let mudou = false;
      for (const k of Object.keys(entrada)) {
        const novo = entrada[k];
        if (!novo || typeof novo.t !== 'number') continue;
        const antigo = atual[k];
        if (!antigo || novo.t >= antigo.t) { atual[k] = { v: novo.v, t: novo.t }; mudou = true; }
      }
      if (mudou) await redis(['SET', CHAVE, JSON.stringify({ campos: atual })]);
      return res.status(200).json({ ok: true, campos: atual });
    }

    return res.status(405).json({ ok: false, erro: 'metodo' });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e.message || e), campos: {} });
  }
};
