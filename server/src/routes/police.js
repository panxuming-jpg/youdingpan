/**
 * 全国派出所检索路由（PRD 模块 G）：
 * 省市区树 / 关键词与距离检索 / 详情 / 用户纠错反馈；管理端维护数据与处理反馈
 * 数据为演示数据（以官方公布为准），updated_at 超 12 个月自动标记 stale
 */
import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { authRequired, adminRequired } from '../middleware.js';

const router = Router();
const STALE_MS = 365 * 86_400_000; // 12 个月

// 查询时计算 stale：updated_at 距今超 12 个月视为信息可能过期
const shape = s => ({
  ...s,
  stale: (s.updated_at && Date.now() - s.updated_at < STALE_MS) ? s.stale : 1,
});

// 省 → 市 → 区 嵌套树
router.get('/police/districts', (_req, res) => {
  const rows = db.prepare('SELECT DISTINCT province, city, district FROM police_stations ORDER BY province, city, district').all();
  const tree = [];
  const findP = p => tree.find(t => t.province === p);
  for (const { province, city, district } of rows) {
    if (!province) continue;
    let pn = findP(province);
    if (!pn) { pn = { province, cities: [] }; tree.push(pn); }
    let cn = pn.cities.find(t => t.city === city);
    if (!cn) { cn = { city, districts: [] }; pn.cities.push(cn); }
    if (district && !cn.districts.includes(district)) cn.districts.push(district);
  }
  res.json({ ok: true, data: tree });
});

// 检索：省市区筛选 + 关键词（名称/地址 LIKE）+ 经纬度近似距离排序
router.get('/police/search', (req, res) => {
  const { province, city, district, keyword } = req.query;
  const lng = Number.parseFloat(req.query.lng);
  const lat = Number.parseFloat(req.query.lat);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const where = [], args = [];
  if (province) { where.push('province = ?'); args.push(String(province)); }
  if (city) { where.push('city = ?'); args.push(String(city)); }
  if (district) { where.push('district = ?'); args.push(String(district)); }
  if (keyword) { where.push('(name LIKE ? OR address LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`); }
  const rows = db.prepare(`SELECT * FROM police_stations ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`).all(...args);
  const hasGeo = Number.isFinite(lng) && Number.isFinite(lat);
  const list = rows.map(s => {
    const o = shape(s);
    if (hasGeo && s.lng != null && s.lat != null) {
      // 欧氏近似距离（km）：经纬度差 × 111，经度按纬度余弦修正
      const dx = (s.lng - lng) * Math.cos((lat * Math.PI) / 180) * 111;
      const dy = (s.lat - lat) * 111;
      o.distance_km = Math.round(Math.sqrt(dx * dx + dy * dy) * 100) / 100;
    }
    return o;
  });
  if (hasGeo) list.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  res.json({ ok: true, data: list.slice(0, limit) });
});

// ---------- 实时补充查询（高德 POI，仅展示不落库；须置于 /police/:id 之前避免路由吞噬） ----------

// Key 来源：环境变量 AMAP_KEY 优先，其次管理端在 settings 表配置的 amap_key
function amapKey() { return process.env.AMAP_KEY || getSetting('amap_key'); }

router.get('/police/realtime-status', (_req, res) => {
  res.json({ ok: true, data: { enabled: !!amapKey() } });
});

router.get('/police/realtime', async (req, res) => {
  const key = amapKey();
  if (!key) return res.json({ ok: false, error: '实时补充查询未启用：请在管理后台「派出所数据」配置高德 Web 服务 Key，或设置服务端环境变量 AMAP_KEY' });
  const keyword = String(req.query.keyword || '派出所').trim().slice(0, 30) || '派出所';
  const city = String(req.query.city || '').trim().slice(0, 20);
  const lng = Number.parseFloat(req.query.lng);
  const lat = Number.parseFloat(req.query.lat);
  const page = Math.min(20, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const clean = v => { const s = String(v || ''); return !s || s === '[]' ? '' : s; };
  try {
    const url = new URL(Number.isFinite(lng) && Number.isFinite(lat)
      ? `https://restapi.amap.com/v3/place/around?keywords=${encodeURIComponent(keyword)}&location=${lng},${lat}&radius=5000&sortrule=distance`
      : `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&citylimit=${city ? 'true' : 'false'}`);
    url.searchParams.set('offset', '20');
    url.searchParams.set('page', String(page));
    url.searchParams.set('extensions', 'all');
    url.searchParams.set('key', key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let j;
    try { j = await (await fetch(url, { signal: ctrl.signal })).json(); } finally { clearTimeout(timer); }
    if (j.status !== '1') return res.json({ ok: false, error: `高德查询失败（${j.info || j.infocode || '未知错误'}），请检查 Key、签名方式与配额` });
    const list = (j.pois || []).map(p => {
      const [plng, plat] = String(p.location || '').split(',').map(Number);
      return {
        name: p.name,
        district: clean(p.adname),
        address: clean(p.address),
        tel: clean(p.telephone),
        lng: Number.isFinite(plng) ? plng : null,
        lat: Number.isFinite(plat) ? plat : null,
        amap_link: Number.isFinite(plng) && Number.isFinite(plat)
          ? `https://uri.amap.com/marker?position=${plng},${plat}&name=${encodeURIComponent(p.name)}&src=youdingpan&coordinate=gaode&callnative=0`
          : '',
      };
    });
    res.json({ ok: true, data: { list, count: Number(j.count) || list.length, source: '数据由高德地图（POI）提供，仅供参考，请以官方公布为准' } });
  } catch (e) {
    res.json({ ok: false, error: `实时查询超时或网络异常：${e.message}` });
  }
});

// 配置高德 Web 服务 Key（存 settings，即时生效无需重启；传空串=关闭）
router.post('/admin/police/amap-key', authRequired, adminRequired, (req, res) => {
  const key = String(req.body?.key || '').trim();
  if (key && !/^[0-9a-zA-Z]{8,64}$/.test(key)) return res.json({ ok: false, error: 'Key 格式不正确（高德 Web 服务 Key，8-64 位字母数字）' });
  setSetting('amap_key', key);
  res.json({ ok: true, data: { enabled: !!key || !!process.env.AMAP_KEY } });
});

// 详情
router.get('/police/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM police_stations WHERE id=?').get(Number(req.params.id));
  if (!s) return res.json({ ok: false, error: '派出所不存在' });
  res.json({ ok: true, data: shape(s) });
});

// 用户纠错反馈
router.post('/police/:id/feedback', authRequired, (req, res) => {
  const s = db.prepare('SELECT id FROM police_stations WHERE id=?').get(Number(req.params.id));
  if (!s) return res.json({ ok: false, error: '派出所不存在' });
  const issue = String(req.body?.issue || '').trim();
  if (!issue) return res.json({ ok: false, error: '请填写纠错内容' });
  const r = db.prepare('INSERT INTO police_feedback (station_id, user_id, issue, status, created_at) VALUES (?,?,?, ?,?)')
    .run(s.id, req.user.id, issue.slice(0, 500), 'open', Date.now());
  res.json({ ok: true, data: { feedback_id: Number(r.lastInsertRowid) } });
});

// ---------- 管理端 ----------

// 列表（分页 + 筛选）
router.get('/admin/police', authRequired, adminRequired, (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const size = Math.min(100, Math.max(1, Number.parseInt(req.query.size, 10) || 20));
  const { province, keyword } = req.query;
  const where = [], args = [];
  if (province) { where.push('province = ?'); args.push(String(province)); }
  if (keyword) { where.push('(name LIKE ? OR address LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM police_stations ${clause}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM police_stations ${clause} ORDER BY id LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  res.json({ ok: true, data: { list: rows.map(shape), total, page, size } });
});

// 新建/更新
router.post('/admin/police', authRequired, adminRequired, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const province = String(b.province || '').trim();
  if (!name || !province) return res.json({ ok: false, error: '名称与省份为必填' });
  const fields = {
    name, province,
    city: String(b.city || '').trim(), district: String(b.district || '').trim(),
    address: String(b.address || '').trim(), phone: String(b.phone || '').trim(),
    officer: String(b.officer || '').trim(), officer_badge: String(b.officer_badge || '').trim(),
    jurisdiction: String(b.jurisdiction || '').trim(), hours: String(b.hours || '').trim(),
    lng: Number.isFinite(Number(b.lng)) ? Number(b.lng) : null,
    lat: Number.isFinite(Number(b.lat)) ? Number(b.lat) : null,
    source: String(b.source || '管理端录入').slice(0, 100),
  };
  const now = Date.now();
  if (b.id) {
    const exist = db.prepare('SELECT id FROM police_stations WHERE id=?').get(Number(b.id));
    if (!exist) return res.json({ ok: false, error: '派出所不存在' });
    db.prepare(`UPDATE police_stations SET name=?,province=?,city=?,district=?,address=?,phone=?,officer=?,officer_badge=?,jurisdiction=?,hours=?,lng=?,lat=?,source=?,updated_at=?,stale=0 WHERE id=?`)
      .run(...Object.values(fields), now, Number(b.id));
    return res.json({ ok: true, data: { id: Number(b.id), action: 'updated' } });
  }
  const r = db.prepare(`INSERT INTO police_stations (name,province,city,district,address,phone,officer,officer_badge,jurisdiction,hours,lng,lat,source,updated_at,stale) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    .run(...Object.values(fields), now);
  res.json({ ok: true, data: { id: Number(r.lastInsertRowid), action: 'created' } });
});

// 批量导入：按 name+district 幂等 upsert
router.post('/admin/police/import', authRequired, adminRequired, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.json({ ok: false, error: 'rows 不能为空' });
  const now = Date.now();
  let inserted = 0, updated = 0, skipped = 0;
  for (const b of rows) {
    const name = String(b.name || '').trim();
    const province = String(b.province || '').trim();
    if (!name || !province) { skipped++; continue; }
    const district = String(b.district || '').trim();
    const exist = db.prepare('SELECT id FROM police_stations WHERE name=? AND IFNULL(district,\'\')=?').get(name, district);
    const fields = [
      name, province, String(b.city || '').trim(), district,
      String(b.address || '').trim(), String(b.phone || '').trim(),
      String(b.officer || '').trim(), String(b.officer_badge || '').trim(),
      String(b.jurisdiction || '').trim(), String(b.hours || '').trim(),
      Number.isFinite(Number(b.lng)) ? Number(b.lng) : null,
      Number.isFinite(Number(b.lat)) ? Number(b.lat) : null,
      String(b.source || '批量导入').slice(0, 100),
    ];
    if (exist) {
      db.prepare(`UPDATE police_stations SET name=?,province=?,city=?,district=?,address=?,phone=?,officer=?,officer_badge=?,jurisdiction=?,hours=?,lng=?,lat=?,source=?,updated_at=?,stale=0 WHERE id=?`)
        .run(...fields, now, exist.id);
      updated++;
    } else {
      db.prepare(`INSERT INTO police_stations (name,province,city,district,address,phone,officer,officer_badge,jurisdiction,hours,lng,lat,source,updated_at,stale) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
        .run(...fields, now);
      inserted++;
    }
  }
  res.json({ ok: true, data: { inserted, updated, skipped } });
});

// 反馈列表
router.get('/admin/police/feedbacks', authRequired, adminRequired, (_req, res) => {
  const rows = db.prepare(`SELECT f.*, s.name AS station_name FROM police_feedback f
    LEFT JOIN police_stations s ON s.id=f.station_id ORDER BY f.id DESC LIMIT 200`).all();
  res.json({ ok: true, data: rows });
});

// 处理反馈：标记 resolved 并写入修正备注
router.post('/admin/police/feedbacks/:id/resolve', authRequired, adminRequired, (req, res) => {
  const f = db.prepare('SELECT * FROM police_feedback WHERE id=?').get(Number(req.params.id));
  if (!f) return res.json({ ok: false, error: '反馈不存在' });
  const fixedText = String(req.body?.fixed_text || '').trim().slice(0, 500);
  db.prepare(`UPDATE police_feedback SET status='resolved', fix_note=? WHERE id=?`).run(fixedText, f.id);
  // 若反馈关联派出所存在，刷新 updated_at 消除 stale 标记
  if (f.station_id) db.prepare('UPDATE police_stations SET updated_at=? WHERE id=?').run(Date.now(), f.station_id);
  res.json({ ok: true, data: { id: f.id, status: 'resolved' } });
});

export default router;
