const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const root = __dirname;
// On a Render Persistent Disk, set RETONE_DATA_DIR to the disk mount path.
// Without it the local file is intentionally only a development fallback.
const dataDir = process.env.RETONE_DATA_DIR || root;
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'data.json');
let db = load();
db.friendships ||= [];
db.notifications ||= [];
db.analysisCache ||= {};
const pendingAnalyses = new Map();
const typingStates = new Map();
let statePool = null;
let saveQueue = Promise.resolve();

function load() {
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
  catch { return { users: [], rooms: [], messages: [], agreements: [] }; }
}
async function initializeStorage() {
  if (!process.env.DATABASE_URL) { console.warn('Persistent storage is not configured; using local fallback.'); return; }
  try {
    statePool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await statePool.query('CREATE TABLE IF NOT EXISTS retone_state (id INTEGER PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const saved = await statePool.query('SELECT payload FROM retone_state WHERE id = 1');
    if (saved.rowCount) db = saved.rows[0].payload;
    else await statePool.query('INSERT INTO retone_state (id, payload) VALUES (1, $1::jsonb)', [JSON.stringify(db)]);
    db.friendships ||= [];
    db.notifications ||= [];
    db.analysisCache ||= {};
    console.log('Re:Tone persistent Postgres storage connected.');
  } catch (error) {
    statePool = null;
    console.error(`Persistent storage fallback: ${error.name || 'connection failed'}`);
  }
}
const storageReady = initializeStorage();
function save() {
  const snapshot = JSON.stringify(db);
  if (!statePool) { fs.writeFileSync(dbPath, snapshot); return; }
  saveQueue = saveQueue.then(() => statePool.query('INSERT INTO retone_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()', [snapshot])).catch(error => console.error(`Persistent storage save failed: ${error.name || 'request failed'}`));
}
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function prunePendingAnalyses() { const now = Date.now(); for (const [key, value] of pendingAnalyses) if (value.expiresAt <= now) pendingAnalyses.delete(key); }
function phoneHash(phone) { return crypto.createHash('sha256').update(String(phone).replace(/\D/g, '')).digest('hex'); }
function passwordHash(password) { const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync(String(password), salt, 32).toString('hex'); return `${salt}:${hash}`; }
function passwordMatches(password, stored) { if (!stored || !String(stored).includes(':')) return false; const [salt, hash] = String(stored).split(':'); const candidate = crypto.scryptSync(String(password), salt, 32).toString('hex'); return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex')); }
function isDemoAdmin(phone, nickname, password) { return String(phone).replace(/\D/g, '') === '12341234' && String(nickname).trim() === '12341234' && String(password) === '12341234'; }
function friendCode() { let code; do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (db.users.some(u => u.friendCode === code)); return code; }
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function body(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid json')); } }); }); }
function publicUser(user) {
  if (!user || user.deleted) return { id: user?.id || 'deleted', nickname: '탈퇴한 사용자', deleted: true };
  return { id: user.id, nickname: user.nickname, avatar: user.avatar || null, createdAt: user.createdAt };
}
function privateUser(user) { return { ...publicUser(user), friendCode: user.friendCode, isAdmin: Boolean(user.isAdmin) }; }
function roomForUser(room, userId) { const { mutedBy, readBy, pinnedBy, ...safeRoom } = room; return { ...safeRoom, memberCount: room.memberIds.length, joined: room.memberIds.includes(userId), notificationsMuted: Boolean(mutedBy?.includes(userId)), pinned: Boolean(pinnedBy?.includes(userId)) }; }
function currentUser(userId) { return db.users.find(u => u.id === userId && !u.deleted); }
function deleteUserAccount(user) { user.deleted = true; user.deletedAt = Date.now(); user.nickname = '탈퇴한 사용자'; user.avatar = null; user.phoneHash = null; user.passwordHash = null; db.rooms.forEach(room => { room.memberIds = room.memberIds.filter(memberId => memberId !== user.id); }); db.friendships = db.friendships.filter(f => f.fromId !== user.id && f.toId !== user.id); }
function validAvatar(avatar) {
  return avatar === null || (typeof avatar === 'string' && avatar.length <= 300000 && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(avatar));
}
function toneCheck(text) {
  const clean = String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\-_.~!]/g, '').replace(/(.)\1{2,}/g, '$1$1');
  const profanity = [
    '씨발','시발','시발애','시밞','씨밞','시발놈','시발년','시발새끼','ㅅㅂ','ㅆㅂ','ㅅㅃ','ㅆㅃ','ㅅ발','시1발','시발ㄹ','ㅅㅂㄹ',
    '개새끼','개새','개샛기','개색기','ㄱㅅㄲ','개ㅅㄲ','씹새끼','씹쌔끼','ㅆㅅㄲ','ㅆㄴ','씹년','씹놈',
    '병신','병1신','ㅂㅅ','등신','등싄','지랄','지럴','ㅈㄹ','좆','죳','ㅈㄷ','존나','존내','졸라','ㅈㄴ','조까','ㅈ까','조까라','꺼져라',
    '닥쳐','닥쳐라','ㄷㅊ','꺼져','ㄲㅈ','새끼','ㅅㄲ','미친','미친놈','미친년','ㅁㅊ','ㅁㅊㄴ','미친새끼','돌았냐','돌았나','또라이','ㅌㄹㅇ',
    '죽어','죽어라','죽인다','죽여','죽여버린다','패버린다','패준다','가만안둬','찾아간다','엿먹어','엿이나먹어','꺼져버려'
  ];
  const categories = [];
  const matched = profanity.filter(x => clean.includes(x.replace(/[\s\-_.~!]/g, '')));
  if (matched.length) categories.push('강한 욕설');
  if (/(너|네가|니가|너는).{0,12}(문제|때문|한심|답답|최악|싫어|꼴도|꺼져)/.test(text)) categories.push('직접 비난');
  if (/(죽어|죽인다|죽여|패버|가만 안 둬|찾아간다|두고 보자)/.test(text)) categories.push('위협 표현');
  if (/(나가|빠져|말 걸지 마|끼지 마|너랑 못|차단할 거|다신 보지)/.test(text)) categories.push('배제 표현');
  if (/(당장|지금 바로|왜 답이 없어|읽씹|빨리 답|무조건 해)/.test(text)) categories.push('강한 압박');
  if (/(몸매|벗어|사진 보내|만져|야한)/.test(text)) categories.push('불편할 수 있는 성적 표현');
  const critical = categories.some(x => x === '위협 표현' || x === '불편할 수 있는 성적 표현');
  return { level: critical ? 'critical' : (categories.length ? 'high' : 'none'), categories, matched };
}
const FREE_PASS_MESSAGES = new Set(['ㅋ','ㅋㅋ','ㅋㅋㅋ','ㅋㅋㅋㅋ','ㅋㅋㅋㅋㅋ','ㅋㅋㅋㅋㅋㅋ','ㅋㅋㅋㅋㅋㅋㅋ','ㅎ','ㅎㅎ','ㅎㅎㅎ','ㅎㅎㅎㅎ','ㅎㅎㅎㅎㅎ','ㅎㅇ','ㅎㅇㅎㅇ','안녕','안뇽','안녕하세용','안녕하세요','하이','하이요','헬로','반가워','반갑다','반갑습니다','굿모닝','굿나잇','좋은아침','좋은 아침','잘자','잘 자','잘자요','굿밤','수고','수고했어','수고했어요','수고하셨어요','고마워','고마워요','감사','감사해','감사합니다','ㄱㅅ','ㄱㅅㄱㅅ','땡큐','ㅇㅋ','ㅇㅋㅇㅋ','오케이','오키','오키오키','넵','넹','네','예','응','웅','ㅇㅇ','ㅇㅇㅇ','ㅇㅇㅇㅇ','ㄴㄴ','ㄴㄴㄴ','아니','아뇨','노','ㄴ','ㄹㅇ','ㅇㄱㄹㅇ','ㄹㅇㅋㅋ','헐','헉','오','오오','오잉','와','와우','대박','굿','굳','굳굳','ㅊㅋ','ㅊㅊ','축하','축하해','축하합니다','ㅃㅇ','ㅂㅂ','바이','빠이','잘가','잘 가','다녀와','다녀오세요','화이팅','파이팅','ㅍㅇㅌ','힘내','힘내요','ㅈㅅ','ㅈㅅㅈㅅ','죄송','죄송해요','미안','미안해','미안합니다','괜찮아','괜찮아요','노노','맞아','맞아요','그래','그래요','그러게','그치','그쵸','ㅇㅈ','인정','ㅇㅋㄷㅋ','가능','가능해','가능합니다','확인','확인했어','확인했습니다','알겠어','알겠어요','알겠습니당','오케바리','좋아','좋아요','좋지','좋습니다','ㄱㄱ','고고','가자','ㄱㅂㅈㄱ','ㄷㄷ','ㅋㅋㄹㅃㅃ','ㅇㅁㅇ','ㅜㅜ','ㅠㅠ','ㅠㅠㅠ','ㅜㅜㅜ','ㅜㅠ','ㅇㅅㅇ','ㅇㅂㅇ','ㅇㅈㅇㅈ','ㅇㅇ맞아','넹넹','네네','오케오케','ㄱㄱㄱ','ㅊㅊㅊ','ㄳ','감삼다','감사링','잘했어','잘했어요','수고수고','파이팅','굿잡','good','yes','no','ok','okay','yep','yup','sure','thanks','thank you','thx','ty','lol','lmao','rofl','hi','hello','hey','bye','good night','good morning','nice','great','cool','awesome']);
function isFreePassMessage(text) {
  const raw = String(text || '').trim().toLowerCase();
  const normalized = raw.replace(/[!?~.]/g, '');
  return raw.length <= 24 && (FREE_PASS_MESSAGES.has(normalized) || /^[ㅋㅎ]+$/.test(raw) || /^\?+$/.test(raw));
}
// Store only a fingerprint, never the original message text.  This lets an
// already-reviewed message be sent quickly without adding a second copy of a
// student's wording to the database.
function analysisCacheKey(text) {
  const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[“”]/g, '"');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
function cachedAnalysis(text) {
  const entry = db.analysisCache?.[analysisCacheKey(text)];
  // AI guidance can change as the app is improved, so do not reuse an old
  // result forever.  A cache entry is still shared by every chat room.
  if (!entry || entry.version !== 1 || !entry.analysis || Date.now() - entry.checkedAt > 1000 * 60 * 60 * 24 * 90) return null;
  return {
    ...entry.analysis,
    tone: { ...entry.analysis.tone, source: 'cache' },
    cacheHit: true
  };
}
function rememberAnalysis(text, analysis) {
  // A fallback may be caused by a timeout or missing key; caching it would
  // incorrectly turn a temporary failure into a permanent result.
  if (analysis?.tone?.source !== 'openai') return analysis;
  const key = analysisCacheKey(text);
  db.analysisCache ||= {};
  db.analysisCache[key] = {
    version: 1,
    checkedAt: Date.now(),
    analysis: { ...analysis, tone: { ...analysis.tone, source: 'openai' } }
  };
  const keys = Object.keys(db.analysisCache);
  if (keys.length > 1500) {
    keys.sort((a, b) => db.analysisCache[a].checkedAt - db.analysisCache[b].checkedAt)
      .slice(0, keys.length - 1500).forEach(keyToRemove => delete db.analysisCache[keyToRemove]);
  }
  save();
  return { ...analysis, cacheHit: false };
}
async function analyzeMessage(text, history = []) {
  const cached = cachedAnalysis(text);
  if (cached) return cached;
  return rememberAnalysis(text, await analyzeWithOpenAI(text, history));
}
function agreementCheck(text) {
  return /(해줘|해줄래|만들어줘|정리해줘|보내줘|맡아줘|준비해줘|조사해줘|제출해|완성해|공유해|담당해|해라|해|해야|역할|담당자|마감|까지|전까지|몇 시|내일|모레|이번 주|다음 주|월요일|화요일|수요일|목요일|금요일|토요일|일요일|하자|하기로|맡을게|만날래|만나자|회의|약속|일정|예약|결정하자|자료|발표|과제|보고서)/.test(text);
}
function fallbackAnalysis(text) {
  const tone = toneCheck(text);
  return {
    tone: { ...tone, source: 'rule', needsReview: tone.categories.length > 0, reason: tone.categories.length ? '상대에게 강하거나 불편하게 들릴 수 있는 표현이 있어요.' : '' },
    agreementCandidate: agreementCheck(text),
    agreementDraft: agreementCheck(text) ? { task: String(text).trim(), assignee: '미정', deadline: '미정' } : null
  };
}
async function analyzeWithOpenAI(text, history = []) {
  const fallback = fallbackAnalysis(text);
  if (!process.env.OPENAI_API_KEY) { console.warn('OpenAI analysis fallback: OPENAI_API_KEY is not configured'); return fallback; }
  const instructions = '너는 청소년 협업 채팅 앱 Re:Tone의 빠르고 절제된 메시지 점검기다. 최종 판정은 오직 current_message 자체만으로 내린다. 이전 대화의 욕설·갈등·분위기 때문에 안전한 현재 문장을 경고하면 안 된다. "어어", "응", "안녕", 짧은 답, 정보 전달, 정중한 부탁, 협업 지시는 항상 needsReview=false다. 명백한 욕설(우회 오타·초성 포함), 위협, 직접적인 인신공격·비난, 조롱, 반복적 또는 강한 압박일 때만 needsReview=true다. 역할·기한·부탁·과제는 말맞춤 후보일 뿐 표현 경고 사유가 아니다. 반드시 JSON만 반환한다. JSON 형식: {"categories":["강한 욕설|직접 비난|위협 표현|배제 표현|강한 압박|무뚝뚝한 명령|오해 가능 표현"],"severity":"none|low|high|critical","needsReview":true|false,"reason":"30자 이내 한국어","suggestion":"원래 의도를 유지한 대체 문장 또는 빈 문자열","agreementCandidate":true|false,"agreementDraft":{"task":"","assignee":"미정","deadline":"미정"}|null}.';
  const input = `current_message: ${text}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    // Chat Completions의 JSON 모드는 Responses 형식 호환성 문제를 피하면서도
    // 이 앱처럼 짧은 한 문장 점검에 빠르게 적합하다.
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 220,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: input }
        ]
      }), signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      const detail = String(failure?.error?.message || failure?.error?.code || '').replace(/[\r\n]/g, ' ').slice(0, 180);
      console.warn(`OpenAI analysis fallback: API returned HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
      return fallback;
    }
    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    const categories = Array.isArray(parsed.categories) ? parsed.categories.slice(0, 4).map(String) : [];
    const severity = ['none', 'low', 'high', 'critical'].includes(parsed.severity) ? parsed.severity : (categories.length ? 'low' : 'none');
    const agreementCandidate = Boolean(parsed.agreementCandidate);
    const reviewCategories = new Set(['강한 욕설', '직접 비난', '위협 표현', '배제 표현', '강한 압박']);
    const needsReview = Boolean(parsed.needsReview) && categories.some(category => reviewCategories.has(category));
    return { tone: { level: severity, categories, matched: [], source: 'openai', needsReview, reason: String(parsed.reason || '').slice(0, 100), suggestion: String(parsed.suggestion || '').slice(0, 300) }, agreementCandidate, agreementDraft: agreementCandidate ? { task: String(parsed.agreementDraft?.task || text).slice(0, 300), assignee: String(parsed.agreementDraft?.assignee || '미정').slice(0, 40), deadline: String(parsed.agreementDraft?.deadline || '미정').slice(0, 60) } : null };
  } catch (error) { console.warn(`OpenAI analysis fallback: ${error.name || 'request failed'}`); return fallback; }
}

const server = http.createServer(async (req, res) => {
  await storageReady;
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const file = url.pathname === '/' ? 'public/index.html' : `public${url.pathname}`;
    const full = path.join(root, file);
    if (!full.startsWith(path.join(root, 'public')) || !fs.existsSync(full)) { res.writeHead(404); return res.end('Not found'); }
    const type = full.endsWith('.css') ? 'text/css' : full.endsWith('.js') ? 'application/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return fs.createReadStream(full).pipe(res);
  }
  try {
    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const { phone, nickname, password, allowDuplicate } = await body(req);
      const admin = isDemoAdmin(phone, nickname, password);
      if (!phone || !nickname || (!admin && nickname.trim().length < 2) || !password || String(password).length < 6) return json(res, 400, { error: '전화번호, 이름, 6자 이상 비밀번호를 입력해 주세요.' });
      const hash = phoneHash(phone);
      const existing = db.users.some(u => !u.deleted && u.phoneHash === hash);
      if (existing && !allowDuplicate) return json(res, 409, { duplicate: true });
      const user = { id: id('user'), phoneHash: hash, passwordHash: passwordHash(password), nickname: nickname.trim().slice(0, 12), friendCode: friendCode(), isAdmin: admin, createdAt: Date.now() };
      db.users.push(user); save(); return json(res, 201, { user: privateUser(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const { phone, nickname, password } = await body(req);
      const hash = phoneHash(phone);
      const user = db.users.find(u => !u.deleted && u.phoneHash === hash && u.nickname === String(nickname || '').trim());
      if (!user) return json(res, 404, { error: '전화번호, 이름 또는 비밀번호를 다시 확인해 주세요.' });
      if (!user.passwordHash) { user.passwordHash = passwordHash(password); save(); }
      else if (!passwordMatches(password, user.passwordHash)) return json(res, 401, { error: '전화번호, 이름 또는 비밀번호를 다시 확인해 주세요.' });
      return json(res, 200, { user: privateUser(user) });
    }
    const profileMatch = url.pathname.match(/^\/api\/profile\/([^/]+)$/);
    if (req.method === 'GET' && profileMatch) {
      const user = currentUser(profileMatch[1]);
      if (!user) return json(res, 404, { error: '사용자를 찾을 수 없어요.' });
      return json(res, 200, { user: privateUser(user) });
    }
    if (req.method === 'PATCH' && profileMatch) {
      const user = currentUser(profileMatch[1]); const { userId, avatar } = await body(req);
      if (!user || user.id !== userId) return json(res, 403, { error: '프로필을 확인할 수 없어요.' });
      if (!validAvatar(avatar)) return json(res, 400, { error: '사진은 300KB 이하의 JPG, PNG 또는 WebP만 사용할 수 있어요.' });
      user.avatar = avatar || null;
      save();
      return json(res, 200, { user: privateUser(user) });
    }
    if (req.method === 'DELETE' && profileMatch) {
      const user = currentUser(profileMatch[1]);
      if (!user) return json(res, 404, { error: '삭제할 계정을 찾을 수 없어요.' });
      deleteUserAccount(user);
      save();
      return json(res, 200, { deleted: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      const admin = currentUser(url.searchParams.get('adminId'));
      if (!admin?.isAdmin) return json(res, 403, { error: '관리자 권한이 필요해요.' });
      return json(res, 200, db.users.filter(u => !u.deleted).map(publicUser));
    }
    const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (req.method === 'DELETE' && adminUserMatch) {
      const admin = currentUser(url.searchParams.get('adminId')); const target = currentUser(adminUserMatch[1]);
      if (!admin?.isAdmin) return json(res, 403, { error: '관리자 권한이 필요해요.' });
      if (!target) return json(res, 404, { error: '사용자를 찾을 수 없어요.' });
      if (target.id === admin.id) return json(res, 400, { error: '관리자 계정은 여기서 삭제할 수 없어요.' });
      deleteUserAccount(target); save(); return json(res, 200, { deleted: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/friends') {
      const userId = url.searchParams.get('userId');
      if (!currentUser(userId)) return json(res, 403, { error: '사용자를 확인할 수 없어요.' });
      const friends = db.friendships.filter(f => f.fromId === userId || f.toId === userId).map(f => {
        const otherId = f.fromId === userId ? f.toId : f.fromId;
        return { ...f, direction: f.fromId === userId ? 'outgoing' : 'incoming', user: publicUser(db.users.find(u => u.id === otherId)) };
      });
      return json(res, 200, friends);
    }
    if (req.method === 'GET' && url.pathname === '/api/users') {
      const userId = url.searchParams.get('userId');
      if (!currentUser(userId)) return json(res, 403, { error: '사용자를 확인할 수 없어요.' });
      return json(res, 200, db.users.filter(u => !u.deleted && u.id !== userId).map(publicUser));
    }
    if (req.method === 'GET' && url.pathname === '/api/notifications') {
      const userId = url.searchParams.get('userId');
      if (!currentUser(userId)) return json(res, 403, { error: '사용자를 확인할 수 없어요.' });
      return json(res, 200, db.notifications.filter(notification => {
        if (notification.userId !== userId) return false;
        const room = notification.roomId && db.rooms.find(item => item.id === notification.roomId);
        return !room?.mutedBy?.includes(userId);
      }).slice(-30));
    }
    if (req.method === 'POST' && url.pathname === '/api/friends/request') {
      const { userId, friendCode: code } = await body(req); const user = currentUser(userId);
      const target = db.users.find(u => !u.deleted && u.friendCode === String(code).trim().toUpperCase());
      if (!user || !target) return json(res, 404, { error: '친구 코드를 찾을 수 없어요.' });
      if (target.id === user.id) return json(res, 400, { error: '내 친구 코드는 추가할 수 없어요.' });
      const exists = db.friendships.find(f => (f.fromId === user.id && f.toId === target.id) || (f.fromId === target.id && f.toId === user.id));
      if (exists) return json(res, 409, { error: '이미 친구 요청을 보냈거나 연결된 친구예요.' });
      const friendship = { id: id('friend'), fromId: user.id, toId: target.id, status: 'pending', createdAt: Date.now() };
      db.friendships.push(friendship); save(); return json(res, 201, friendship);
    }
    const friendAction = url.pathname.match(/^\/api\/friends\/([^/]+)\/(accept|reject)$/);
    if (req.method === 'POST' && friendAction) {
      const [, friendshipId, action] = friendAction; const { userId } = await body(req);
      const friendship = db.friendships.find(f => f.id === friendshipId && f.toId === userId && f.status === 'pending');
      if (!friendship) return json(res, 404, { error: '친구 요청을 찾을 수 없어요.' });
      if (action === 'accept') friendship.status = 'accepted'; else db.friendships = db.friendships.filter(f => f.id !== friendshipId);
      save(); return json(res, 200, { status: action === 'accept' ? 'accepted' : 'rejected' });
    }
    if (req.method === 'POST' && url.pathname === '/api/direct-room') {
      const { userId, friendId } = await body(req); const user = currentUser(userId); const friend = currentUser(friendId);
      if (!user || !friend || userId === friendId) return json(res, 403, { error: '사용자를 확인할 수 없어요.' });
      let room = db.rooms.find(r => r.kind === 'direct' && r.memberIds.length === 2 && r.memberIds.includes(userId) && r.memberIds.includes(friendId));
      if (!room) { room = { id: id('room'), kind: 'direct', name: `${user.nickname} · ${friend.nickname}`, inviteCode: null, memberIds: [userId, friendId], createdAt: Date.now() }; db.rooms.push(room); save(); }
      return json(res, 200, roomForUser(room, userId));
    }
    const deleteMessageMatch = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
    const messageReactionMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/reaction$/);
    if (req.method === 'POST' && messageReactionMatch) {
      const { userId, emoji } = await body(req); const message = db.messages.find(item => item.id === messageReactionMatch[1]);
      const room = message && db.rooms.find(item => item.id === message.roomId);
      if (!message || !room?.memberIds.includes(userId)) return json(res, 403, { error: '메시지에 반응할 수 없어요.' });
      if (!['👍','❤️','😂','✅'].includes(emoji)) return json(res, 400, { error: '지원하지 않는 반응이에요.' });
      message.reactions ||= {}; message.reactions[emoji] ||= [];
      if (message.reactions[emoji].includes(userId)) message.reactions[emoji] = message.reactions[emoji].filter(id => id !== userId);
      else message.reactions[emoji].push(userId);
      if (!message.reactions[emoji].length) delete message.reactions[emoji];
      save(); return json(res, 200, { reactions: Object.fromEntries(Object.entries(message.reactions).map(([key, users]) => [key, users.length])) });
    }
    if (req.method === 'DELETE' && deleteMessageMatch) {
      const userId = url.searchParams.get('userId');
      const message = db.messages.find(m => m.id === deleteMessageMatch[1]);
      if (!message) return json(res, 404, { error: '메시지를 찾을 수 없어요.' });
      if (message.senderId !== userId) return json(res, 403, { error: '내가 보낸 메시지만 삭제할 수 있어요.' });
      db.messages = db.messages.filter(m => m.id !== message.id);
      save(); return json(res, 200, { deleted: true });
    }
    const deleteAgreementMatch = url.pathname.match(/^\/api\/agreements\/([^/]+)$/);
    if (req.method === 'DELETE' && deleteAgreementMatch) {
      const userId = url.searchParams.get('userId');
      const agreement = db.agreements.find(a => a.id === deleteAgreementMatch[1]);
      if (!agreement) return json(res, 404, { error: '약속을 찾을 수 없어요.' });
      if (agreement.creatorId && agreement.creatorId !== userId) return json(res, 403, { error: '만든 사람만 약속을 삭제할 수 있어요.' });
      db.agreements = db.agreements.filter(a => a.id !== agreement.id);
      save(); return json(res, 200, { deleted: true });
    }
    const agreementActionMatch = url.pathname.match(/^\/api\/agreements\/([^/]+)\/(complete|hide)$/);
    if (req.method === 'POST' && agreementActionMatch) {
      const [, agreementId, action] = agreementActionMatch; const { userId } = await body(req); const agreement = db.agreements.find(item => item.id === agreementId);
      const user = currentUser(userId);
      if (!agreement || !user) return json(res, 404, { error: '약속을 찾을 수 없어요.' });
      if (action === 'complete') {
        if (agreement.assignee !== user.nickname) return json(res, 403, { error: '담당자만 완료할 수 있어요.' });
        agreement.status = '완료'; agreement.completedAt = Date.now();
      } else {
        agreement.hiddenBy ||= [];
        if (!agreement.hiddenBy.includes(userId)) agreement.hiddenBy.push(userId);
      }
      save(); return json(res, 200, { agreement });
    }
    if (req.method === 'GET' && url.pathname === '/api/rooms') {
      const userId = url.searchParams.get('userId');
      return json(res, 200, db.rooms.filter(r => r.memberIds.includes(userId)).map(r => roomForUser(r, userId)));
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const { userId, name } = await body(req); const user = currentUser(userId);
      if (!user || !name?.trim()) return json(res, 400, { error: '채팅방 정보를 확인해 주세요.' });
      const room = { id: id('room'), kind: 'group', name: name.trim().slice(0, 30), inviteCode: crypto.randomBytes(3).toString('hex').toUpperCase(), memberIds: [userId], createdAt: Date.now() };
      db.rooms.push(room); save(); return json(res, 201, roomForUser(room, userId));
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms/join') {
      const { userId, inviteCode } = await body(req); const room = db.rooms.find(r => r.inviteCode === String(inviteCode).toUpperCase());
      if (!room || !currentUser(userId)) return json(res, 404, { error: '초대 코드를 찾을 수 없어요.' });
      if (!room.memberIds.includes(userId)) { room.memberIds.push(userId); room.readBy ||= {}; room.readBy[userId] = db.messages.filter(message => message.roomId === room.id).at(-1)?.id || null; } save(); return json(res, 200, roomForUser(room, userId));
    }
    const roomReadMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/read$/);
    if (req.method === 'POST' && roomReadMatch) {
      const room = db.rooms.find(item => item.id === roomReadMatch[1]); const { userId, messageId } = await body(req);
      if (!room || !room.memberIds.includes(userId)) return json(res, 403, { error: '채팅방에 접근할 수 없어요.' });
      const message = db.messages.find(item => item.id === messageId && item.roomId === room.id);
      if (!message) return json(res, 404, { error: '메시지를 찾을 수 없어요.' });
      room.readBy ||= {};
      if (room.readBy[userId] !== messageId) { room.readBy[userId] = messageId; save(); }
      return json(res, 200, { read: true });
    }
    const roomPinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/pin$/);
    if (req.method === 'POST' && roomPinMatch) {
      const room = db.rooms.find(item => item.id === roomPinMatch[1]); const { userId, pinned } = await body(req);
      if (!room || !room.memberIds.includes(userId)) return json(res, 403, { error: '채팅방에 접근할 수 없어요.' });
      room.pinnedBy ||= [];
      if (pinned && !room.pinnedBy.includes(userId)) room.pinnedBy.push(userId);
      if (!pinned) room.pinnedBy = room.pinnedBy.filter(memberId => memberId !== userId);
      save(); return json(res, 200, { pinned: Boolean(pinned) });
    }
    const roomNotificationSetting = url.pathname.match(/^\/api\/rooms\/([^/]+)\/notification-setting$/);
    if (req.method === 'POST' && roomNotificationSetting) {
      const room = db.rooms.find(item => item.id === roomNotificationSetting[1]); const { userId, muted } = await body(req);
      if (!room || !room.memberIds.includes(userId)) return json(res, 403, { error: '채팅방에 접근할 수 없어요.' });
      room.mutedBy ||= [];
      if (muted && !room.mutedBy.includes(userId)) room.mutedBy.push(userId);
      if (!muted) room.mutedBy = room.mutedBy.filter(memberId => memberId !== userId);
      save(); return json(res, 200, { notificationsMuted: Boolean(muted) });
    }
    const roomAction = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(leave|invite)$/);
    if (req.method === 'POST' && roomAction) {
      const [, roomId, action] = roomAction;
      const { userId, friendId } = await body(req);
      const room = db.rooms.find(r => r.id === roomId);
      if (!room || !room.memberIds.includes(userId)) return json(res, 403, { error: '채팅방에 접근할 수 없어요.' });
      if (action === 'leave') {
        room.memberIds = room.memberIds.filter(memberId => memberId !== userId);
        room.mutedBy = (room.mutedBy || []).filter(memberId => memberId !== userId);
        room.pinnedBy = (room.pinnedBy || []).filter(memberId => memberId !== userId);
        if (room.readBy) delete room.readBy[userId];
        save(); return json(res, 200, { left: true });
      }
      const friend = currentUser(friendId);
      if (room.kind === 'direct') return json(res, 400, { error: '1:1 채팅에는 친구를 초대할 수 없어요.' });
      if (!friend) return json(res, 404, { error: '초대할 사용자를 찾을 수 없어요.' });
      if (!room.memberIds.includes(friendId)) {
        room.memberIds.push(friendId);
        room.readBy ||= {}; room.readBy[friendId] = db.messages.filter(message => message.roomId === room.id).at(-1)?.id || null;
        db.notifications.push({ id: id('notice'), userId: friendId, type: 'room-invite', roomId, roomName: room.name, inviter: currentUser(userId).nickname, createdAt: Date.now() });
      }
      save(); return json(res, 200, roomForUser(room, userId));
    }
    const analyzeMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/analyze$/);
    const typingMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/typing$/);
    if (typingMatch) {
      const roomId = typingMatch[1]; const room = db.rooms.find(r => r.id === roomId); const userId = url.searchParams.get('userId');
      if (!room || !room.memberIds.includes(userId)) return json(res, 403, { error: '채팅방에 접근할 수 없어요.' });
      if (req.method === 'POST') { typingStates.set(`${roomId}:${userId}`, Date.now() + 3200); return json(res, 200, { typing: true }); }
      if (req.method === 'GET') {
        const now = Date.now(); const users = room.memberIds.filter(id => id !== userId && typingStates.get(`${roomId}:${id}`) > now).map(id => publicUser(currentUser(id)));
        return json(res, 200, { users });
      }
    }
    if (req.method === 'POST' && analyzeMatch) {
      const roomId = analyzeMatch[1]; const room = db.rooms.find(r => r.id === roomId); const userId = url.searchParams.get('userId'); const { content } = await body(req);
      if (!room || !room.memberIds.includes(userId)) return json(res, 403, { error: '채팅방에 접근할 수 없어요.' });
      if (!content?.trim()) return json(res, 400, { error: '메시지를 입력해 주세요.' });
      prunePendingAnalyses();
      const analysis = await analyzeMessage(content.trim().slice(0, 1000), db.messages.filter(m => m.roomId === roomId));
      const analysisId = id('analysis'); pendingAnalyses.set(analysisId, { roomId, userId, content: content.trim().slice(0, 1000), analysis, expiresAt: Date.now() + 90000 });
      return json(res, 200, { analysisId, ...analysis });
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(messages|agreements)$/);
    if (roomMatch) {
      const [, roomId, thing] = roomMatch; const room = db.rooms.find(r => r.id === roomId); const userId = url.searchParams.get('userId');
      if (!room || !room.memberIds.includes(userId)) return json(res, 403, { error: '채팅방에 접근할 수 없어요.' });
      if (req.method === 'GET' && thing === 'messages') {
        const messages = db.messages.filter(m => m.roomId === roomId);
        const messageIndex = new Map(messages.map((message, index) => [message.id, index]));
        return json(res, 200, messages.map((message, index) => {
          const unreadCount = room.memberIds.filter(memberId => memberId !== message.senderId && (messageIndex.get(room.readBy?.[memberId]) ?? -1) < index).length;
          const reactions = Object.fromEntries(Object.entries(message.reactions || {}).map(([emoji, users]) => [emoji, users.length]));
          return { ...message, reactions, unreadCount, sender: publicUser(currentUser(message.senderId)) };
        }));
      }
      if (req.method === 'GET' && thing === 'agreements') return json(res, 200, db.agreements.filter(a => a.roomId === roomId && !a.hiddenBy?.includes(userId) && a.status !== '완료'));
      if (req.method === 'POST' && thing === 'messages') {
        const { content, analysisId, skipAI } = await body(req); if (!content?.trim()) return json(res, 400, { error: '메시지를 입력해 주세요.' });
        const cleanContent = content.trim().slice(0, 1000); const saved = pendingAnalyses.get(analysisId);
        const analysis = saved && saved.roomId === roomId && saved.userId === userId && saved.content === cleanContent && saved.expiresAt > Date.now() ? saved.analysis : (skipAI && isFreePassMessage(cleanContent) ? fallbackAnalysis(cleanContent) : await analyzeMessage(cleanContent, db.messages.filter(m => m.roomId === roomId)));
        if (analysisId) pendingAnalyses.delete(analysisId);
        const message = { id: id('msg'), roomId, senderId: userId, content: cleanContent, createdAt: Date.now(), ...analysis };
        db.messages.push(message); save(); return json(res, 201, { ...message, sender: publicUser(currentUser(userId)) });
      }
      if (req.method === 'POST' && thing === 'agreements') {
        const { task, assignee, deadline, deadlineStart, deadlineEnd } = await body(req); if (!task?.trim()) return json(res, 400, { error: '할 일을 입력해 주세요.' });
        const start = String(deadlineStart || '').slice(0, 10); const end = String(deadlineEnd || deadline || '').slice(0, 10);
        const agreement = { id: id('agreement'), roomId, creatorId: userId, task: task.trim(), assignee: assignee?.trim() || '미정', deadline: end || '미정', deadlineStart: start || null, deadlineEnd: end || null, status: '진행 중', createdAt: Date.now() };
        db.agreements.push(agreement);
        const creator = currentUser(userId);
        room.memberIds.filter(memberId => memberId !== userId).forEach(memberId => db.notifications.push({ id: id('notice'), userId: memberId, type: 'agreement-created', roomId, roomName: room.name, creator: creator?.nickname || '누군가', task: agreement.task, createdAt: Date.now() }));
        save(); return json(res, 201, agreement);
      }
    }
    json(res, 404, { error: '요청을 찾을 수 없어요.' });
  } catch (error) { json(res, 500, { error: '서버 오류가 발생했어요.' }); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Re:Tone is running on port ${PORT}`));
