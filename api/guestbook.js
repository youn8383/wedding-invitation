// 축하 메시지(방명록) API — Vercel Serverless Function + Upstash Redis (REST)
//  - Vercel 대시보드 > Storage > Upstash for Redis 연결 시 아래 환경변수가 자동으로 들어옵니다.
//    KV_REST_API_URL / KV_REST_API_TOKEN  (또는 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const ITEMS = 'guestbook:items'; // hash: id -> JSON
const IDS = 'guestbook:ids';     // zset: id (score = createdAt)
const LIMIT = { name: 20, message: 500, password: 32, list: 200 };
const RATE = { max: 5, windowSec: 60 }; // IP당 1분에 5개까지 작성

async function redis(...commands) {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    const out = await res.json();
    const err = out.find((r) => r.error);
    if (err) throw new Error(err.error);
    return out.map((r) => r.result);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') };
}
function checkPassword(password, { salt, hash }) {
    const a = Buffer.from(hashPassword(password, salt).hash, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const publicEntry = ({ id, name, message, createdAt }) => ({ id, name, message, createdAt });

async function list(res) {
    const [ids] = await redis(['ZREVRANGE', IDS, 0, LIMIT.list - 1]);
    if (!ids.length) return res.status(200).json({ entries: [] });
    const [raw] = await redis(['HMGET', ITEMS, ...ids]);
    const entries = raw.filter(Boolean).map((s) => publicEntry(JSON.parse(s)));
    res.status(200).json({ entries });
}

async function create(req, res) {
    const name = clean(req.body?.name);
    const message = clean(req.body?.message);
    const password = clean(req.body?.password);
    if (!name || !message || !password) return res.status(400).json({ error: '이름, 메시지, 비밀번호를 모두 입력해주세요.' });
    if (name.length > LIMIT.name || message.length > LIMIT.message || password.length > LIMIT.password) {
        return res.status(400).json({ error: '입력이 너무 깁니다.' });
    }

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const rateKey = `guestbook:rate:${ip}`;
    const [count] = await redis(['INCR', rateKey], ['EXPIRE', rateKey, RATE.windowSec, 'NX']);
    if (count > RATE.max) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

    const entry = {
        id: crypto.randomBytes(6).toString('hex'),
        name, message,
        createdAt: Date.now(),
        password: hashPassword(password),
    };
    await redis(['HSET', ITEMS, entry.id, JSON.stringify(entry)], ['ZADD', IDS, entry.createdAt, entry.id]);
    res.status(201).json({ entry: publicEntry(entry) });
}

async function remove(req, res) {
    const id = clean(req.body?.id);
    const password = clean(req.body?.password);
    if (!id || !password) return res.status(400).json({ error: '비밀번호를 입력해주세요.' });
    const [raw] = await redis(['HGET', ITEMS, id]);
    if (!raw) return res.status(404).json({ error: '이미 삭제된 메시지입니다.' });
    if (!checkPassword(password, JSON.parse(raw).password)) return res.status(403).json({ error: '비밀번호가 일치하지 않습니다.' });
    await redis(['HDEL', ITEMS, id], ['ZREM', IDS, id]);
    res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'guestbook storage not configured' });
    try {
        if (req.method === 'GET') return await list(res);
        if (req.method === 'POST') return await create(req, res);
        if (req.method === 'DELETE') return await remove(req, res);
        res.setHeader('Allow', 'GET, POST, DELETE');
        res.status(405).json({ error: 'method not allowed' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
    }
};
