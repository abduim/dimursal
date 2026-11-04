/*
 * Табун — приёмник спутниковых трекеров Globalstar (SmartOne C и похожие).
 * Работает на Cloudflare Workers (бесплатно).
 * Оператор (Spotter / GTC) шлёт сюда XML «stuMessages» по адресу  https://<воркер>/globalstar/<KEY>
 * Ground Control (Cloudloop / Lingo) шлёт JSON по адресу           https://<воркер>/lingo/<KEY>
 * Мы раскладываем точки в Firestore:  farms/{ферма}/pos/{ESN} = {lat, lon, at, batt}
 * Какая ферма — смотрим в trackers/{ESN}.farm (эту запись делает само приложение «Табун Pro»).
 * Секреты воркера:  SA  — JSON-ключ сервисного аккаунта Firebase,  KEY — любой длинный пароль для адреса.
 * © Рахман, Шалкар. Все права защищены.
 */
const PROJECT = 'tabun-kz';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

/* ---------- разбор XML от Globalstar ---------- */
const tag = (x, t) => { const m = new RegExp('<' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + t + '>', 'i').exec(x); return m ? m[1].trim() : ''; };
const attr = (x, a) => { const m = new RegExp('\\b' + a + '\\s*=\\s*"([^"]*)"', 'i').exec(x); return m ? m[1] : ''; };
export function parseStu(xml) {
  const out = [], re = /<stuMessage(?:\s[^>]*)?>([\s\S]*?)<\/stuMessage>/gi; let m;
  while ((m = re.exec(xml))) {
    const b = m[1], esn = tag(b, 'esn').toUpperCase(), t = Number(tag(b, 'unixTime')) * 1000;
    const pm = /<payload([^>]*)>([\s\S]*?)<\/payload>/i.exec(b);
    if (!esn || !pm) continue;
    const pos = decodeSmartOne(pm[2].trim());
    if (pos) out.push(Object.assign({esn, at: t || Date.now()}, pos));
  }
  return out;
}
/* стандартное 9-байтовое сообщение SmartOne C: [флаги][широта 3 байта][долгота 3 байта][состояние][доп.] */
export function decodeSmartOne(hex) {
  hex = hex.replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-f]{18}$/i.test(hex)) return null;
  const B = []; for (let i = 0; i < 18; i += 2) B.push(parseInt(hex.slice(i, i + 2), 16));
  const u24 = i => (B[i] << 16) | (B[i + 1] << 8) | B[i + 2];
  let lat = u24(1) * 90 / 8388608, lon = u24(4) * 180 / 8388608;
  if (lat > 90) lat -= 180; if (lon > 180) lon -= 360;
  if (!isFinite(lat) || !isFinite(lon) || (Math.abs(lat) < 1e-4 && Math.abs(lon) < 1e-4)) return null;
  const low = (B[7] & 1) === 1; /* по описанию SmartOne C: бит 0 байта 7 — «батарея садится» */
  return {lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, low, type: B[0] & 3};
}
/* ответ, который ждёт Globalstar, иначе он будет слать повторно */
function stuResponse(xml, ok, msg) {
  const id = attr(xml, 'messageID') || '0', d = new Date(), p = n => String(n).padStart(2, '0');
  const ts = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`;
  const prv = /<prvMessages/i.test(xml), root = prv ? 'prvResponseMsg' : 'stuResponseMsg', xsd = prv ? 'ProvisionResponse_Rev1_0.xsd' : 'StuResponse_Rev1_0.xsd';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://cody.glpconnect.com/XSD/${xsd}" deliveryTimeStamp="${ts}" correlationID="${id}">\n<state>${ok ? 'pass' : 'fail'}</state>\n<stateMessage>${msg}</stateMessage>\n</${root}>`;
}

/* ---------- разбор JSON от Ground Control (Cloudloop / Lingo) ---------- */
const b64hex = s => { try { return Array.from(atob(s), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; } };
const utc = (d, t) => d && t ? Date.UTC(d.Year ?? d.year, (d.Month ?? d.month) - 1, d.Day ?? d.day, t.Hour ?? t.hour ?? 0, t.Minute ?? t.minute ?? 0, t.Second ?? t.second ?? 0) : NaN;
export function parseLingo(body) {
  let j; try { j = JSON.parse(body); } catch (e) { return []; }
  const list = Array.isArray(j) ? j : Array.isArray(j.messages) ? j.messages : [j], out = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const id = m.identity || {}, esn = String((m.globalstar && m.globalstar.esn) || (id.hardware && id.hardware.esn) || id.identifier || '').toUpperCase();
    if (!esn) continue;
    const mo = m.globalstarMessage && m.globalstarMessage.message && m.globalstarMessage.message.mo, st = mo && mo.standard, pos = st && st.position;
    let at = mo && mo.at ? utc(mo.at.date, mo.at.time) : NaN;
    if (!isFinite(at) && m.receivedAt) { const r = m.receivedAt; at = Date.UTC(r.year, r.month - 1, r.day, r.hour || 0, r.minute || 0, r.second || 0); }
    if (!isFinite(at)) at = Date.now();
    let p = null;
    if (pos && isFinite(pos.lat) && isFinite(pos.lon) && (!st.gpsStatus || st.gpsStatus === 'GPS_STATUS_VALID') && !(Math.abs(pos.lat) < 1e-4 && Math.abs(pos.lon) < 1e-4))
      p = {lat: Math.round(pos.lat * 1e5) / 1e5, lon: Math.round(pos.lon * 1e5) / 1e5, low: st.batteryState === 'BATTERY_STATE_LOW', type: 0};
    else if (!mo && m.message) p = decodeSmartOne(b64hex(m.message)); /* разобранного сообщения нет — читаем сырые 9 байт */
    if (p) out.push(Object.assign({esn, at}, p));
  }
  return out;
}

/* ---------- доступ к Firestore от имени сервисного аккаунта ---------- */
let TOKEN = null;
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(new TextEncoder().encode(s));
async function token(env) {
  if (TOKEN && TOKEN.exp > Date.now() + 60000) return TOKEN.t;
  const sa = JSON.parse(env.SA), now = Math.floor(Date.now() / 1000);
  const head = b64uStr(JSON.stringify({alg: 'RS256', typ: 'JWT'}));
  const body = b64uStr(JSON.stringify({iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600}));
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
  const r = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + b64u(sig)});
  const j = await r.json(); if (!j.access_token) throw new Error('token: ' + JSON.stringify(j));
  TOKEN = {t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000};
  return TOKEN.t;
}
async function fs(env, method, path, body) {
  const r = await fetch(DOCS + path, {method, headers: {authorization: 'Bearer ' + await token(env), 'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  if (r.status === 404) return null;
  const j = await r.json(); if (!r.ok) throw new Error(method + ' ' + path + ': ' + JSON.stringify(j).slice(0, 300));
  return j;
}
const enc = encodeURIComponent;
async function farmOf(env, esn, cache) {
  if (esn in cache) return cache[esn];
  const d = await fs(env, 'GET', '/trackers/' + enc(esn));
  return (cache[esn] = d && d.fields && d.fields.farm ? d.fields.farm.stringValue : '');
}
async function store(env, P) {
  const cache = {}, last = {}; let n = 0, lost = 0;
  P.forEach(p => { if (!last[p.esn] || p.at >= last[p.esn].at) last[p.esn] = p; }); /* в одной посылке может быть несколько точек — берём свежую */
  for (const p of Object.values(last)) {
    const f = await farmOf(env, p.esn, cache);
    const fields = {lat: {doubleValue: p.lat}, lon: {doubleValue: p.lon}, at: {timestampValue: new Date(p.at).toISOString()}, low: {booleanValue: p.low}, got: {timestampValue: new Date().toISOString()}};
    if (f) {
      const old = await fs(env, 'GET', `/farms/${enc(f)}/pos/${enc(p.esn)}`); /* старую точку не пишем поверх новой */
      if (old && old.fields && old.fields.at && Date.parse(old.fields.at.timestampValue) > p.at) continue;
      await fs(env, 'PATCH', `/farms/${enc(f)}/pos/${enc(p.esn)}`, {fields}); n++;
    } else { await fs(env, 'PATCH', '/unclaimed/' + enc(p.esn), {fields}); lost++; } /* трекер ещё не вписан ни у одной лошади */
  }
  return {n, lost};
}
async function logRaw(env, body, note) {
  try { await fs(env, 'POST', '/inbox', {fields: {at: {timestampValue: new Date().toISOString()}, note: {stringValue: note.slice(0, 500)}, body: {stringValue: body.slice(0, 8000)}}}); } catch (e) {}
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), parts = url.pathname.split('/').filter(Boolean);
    const txt = (t, st) => new Response(t, {status: st || 200, headers: {'content-type': 'text/plain; charset=utf-8'}});
    if (req.method === 'GET' && parts[0] === 'test') {
      if (!env.KEY || parts[1] !== env.KEY) return txt('Неверный ключ в адресе.', 404);
      if (!env.SA) return txt('Нет секрета SA в настройках воркера.', 500);
      try { await fs(env, 'POST', '/inbox', {fields: {at: {timestampValue: new Date().toISOString()}, note: {stringValue: 'проверка связи'}, body: {stringValue: ''}}}); return txt('Связь с базой Табуна: всё работает ✅'); }
      catch (e) { return txt('Ошибка связи с базой: ' + e.message, 500); }
    }
    if (req.method === 'GET') return txt('Табун: приёмник трекеров работает.');
    if (parts[0] === 'lingo' && env.KEY && parts[1] === env.KEY) {
      const body = await req.text();
      try {
        const P = parseLingo(body), r = await store(env, P);
        await logRaw(env, body, `lingo: точек ${P.length}, записано ${r.n}, без хозяйства ${r.lost}`);
        return txt('OK');
      } catch (e) { await logRaw(env, body, 'lingo ошибка: ' + e.message); return txt('Store failed', 500); }
    }
    if (parts[0] !== 'globalstar' || !env.KEY || parts[1] !== env.KEY) return new Response('not found', {status: 404});
    const xml = await req.text();
    try {
      if (/<prvMessages/i.test(xml)) { await logRaw(env, xml, 'provisioning'); return new Response(stuResponse(xml, true, 'Provisioning OK'), {headers: {'content-type': 'text/xml'}}); }
      const P = parseStu(xml);
      const r = await store(env, P);
      await logRaw(env, xml, `точек ${P.length}, записано ${r.n}, без хозяйства ${r.lost}`);
      return new Response(stuResponse(xml, true, 'Store OK'), {headers: {'content-type': 'text/xml'}});
    } catch (e) {
      await logRaw(env, xml, 'ошибка: ' + e.message);
      return new Response(stuResponse(xml, false, 'Store failed'), {status: 500, headers: {'content-type': 'text/xml'}});
    }
  }
};
