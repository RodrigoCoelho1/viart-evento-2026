// Mural de fotos do evento VIART 2026 — postadas pelos participantes.
// Guardado numa chave própria do Redis (separada de viart2026:estado) para não
// arriscar o limite de tamanho do valor nem competir com o merge de campos do /api/estado.
//
// GET  /api/fotos  -> { ok:true, fotos:[ {id,autor,imagem,legenda,criadoEm,curtidas:[nomes],comentarios:[{nome,texto,criadoEm}]} ] }
// POST /api/fotos  body:
//   { action:'post',     autor, imagem, legenda }
//   { action:'curtir',   fotoId, nome }          -> alterna curtir/descurtir; ignora se nome === autor
//   { action:'comentar', fotoId, nome, texto }
//   { action:'excluir',  fotoId }                -> moderação (organização)

const CHAVE = 'viart2026:fotos';
const MAX_FOTOS = 300;

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
  if (!bruto) return [];
  try { return JSON.parse(bruto).fotos || []; } catch (e) { return []; }
}

async function gravar(fotos) {
  await redis(['SET', CHAVE, JSON.stringify({ fotos })]);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!credenciais()) {
    return res.status(200).json({ ok: false, erro: 'sem-banco', fotos: [] });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, fotos: await ler() });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const fotos = await ler();

      if (body.action === 'post') {
        if (!body.autor || !body.imagem) return res.status(400).json({ ok: false, erro: 'dados-incompletos' });
        const nova = {
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          autor: body.autor, imagem: body.imagem, legenda: String(body.legenda || '').slice(0, 200),
          criadoEm: Date.now(), curtidas: [], comentarios: [],
        };
        fotos.push(nova);
        if (fotos.length > MAX_FOTOS) fotos.splice(0, fotos.length - MAX_FOTOS);
        await gravar(fotos);
        return res.status(200).json({ ok: true, fotos });
      }

      const foto = fotos.find(f => f.id === body.fotoId);
      if (!foto) return res.status(404).json({ ok: false, erro: 'foto-nao-encontrada', fotos });

      if (body.action === 'curtir') {
        if (!body.nome || body.nome === foto.autor) return res.status(200).json({ ok: true, fotos });
        const i = foto.curtidas.indexOf(body.nome);
        if (i === -1) foto.curtidas.push(body.nome); else foto.curtidas.splice(i, 1);
        await gravar(fotos);
        return res.status(200).json({ ok: true, fotos });
      }

      if (body.action === 'comentar') {
        if (!body.nome || !body.texto) return res.status(400).json({ ok: false, erro: 'dados-incompletos' });
        foto.comentarios.push({ nome: body.nome, texto: String(body.texto).slice(0, 300), criadoEm: Date.now() });
        await gravar(fotos);
        return res.status(200).json({ ok: true, fotos });
      }

      if (body.action === 'excluir') {
        const restantes = fotos.filter(f => f.id !== body.fotoId);
        await gravar(restantes);
        return res.status(200).json({ ok: true, fotos: restantes });
      }

      return res.status(400).json({ ok: false, erro: 'acao-invalida' });
    }

    return res.status(405).json({ ok: false, erro: 'metodo' });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e.message || e), fotos: [] });
  }
};
