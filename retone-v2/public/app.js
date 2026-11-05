const app = document.querySelector("#app");
let data = null,
  roomId = null,
  nav = "chat";
let signedIn = sessionStorage.getItem("retone-v2-name") || "";
let signedInId = sessionStorage.getItem("retone-v2-user-id") || "";
let sessionToken = sessionStorage.getItem("retone-v2-session") || "";
let isAdmin = sessionStorage.getItem("retone-v2-admin") === "yes";
let aiIntervention = sessionStorage.getItem("retone-v2-ai-level") || "standard";
let pendingSend = null;
let pendingAnalysisDraft = "";
let currentRoomMessages = [];
let signupAiDetails = null;
let signupDraft = null;
let signupPhoneTimer = null;
let selectedIntent = "";
let aiPrefetch = { text: "", result: null, promise: null, timer: null };
let roomPollTimer = null;
const browserNotificationsEnabled = () => localStorage.getItem("retone-browser-notifications") === "1";
let aiSavedResults = (() => {
  try {
    return JSON.parse(localStorage.getItem("retone-ai-results-v1") || "{}");
  } catch {
    return {};
  }
})();
let factFindings = (() => {
  try {
    return JSON.parse(localStorage.getItem("retone-fact-findings-v1") || "{}");
  } catch {
    return {};
  }
})();
const factChecksInFlight = new Set();
const aiCategoryDefaults = {
  "강한 공격 표현": "강한 표현만",
  "비꼼·압박 표현": "균형 있게",
  "출처 확인 제안": "중요 정보만",
  "표현 바꾸기": "필요할 때",
  "입력 중 선검사": "켜기",
  "감정 도움 AI": "필요할 때",
  "확인 결과 재사용": "켜기",
  "말맞춤 카드": "약속 대화만",
  "대화 흐름 요약": "갈등 있을 때",
  "이미지 안전 안내": "필요할 때",
};
const sensitivityKeys = [
  "강한 공격 표현",
  "비꼼·압박 표현",
  "출처 확인 제안",
  "표현 바꾸기",
  "입력 중 선검사",
  "감정 도움 AI",
  "확인 결과 재사용",
  "말맞춤 카드",
  "대화 흐름 요약",
  "이미지 안전 안내",
  "대화 온도 타임라인",
  "대화 복구 문장",
];
function sensitivityState() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("retone-ai-sensitivity") || "{}",
    );
    return {
      overall: Number.isFinite(saved.overall) ? saved.overall : 50,
      categories: Object.fromEntries(
        sensitivityKeys.map((key) => [
          key,
          Number.isFinite(saved.categories?.[key]) ? saved.categories[key] : 50,
        ]),
      ),
      overrides: saved.overrides || {},
    };
  } catch {
    return {
      overall: 50,
      categories: Object.fromEntries(sensitivityKeys.map((key) => [key, 50])),
      overrides: {},
    };
  }
}
function saveSensitivity(state) {
  localStorage.setItem("retone-ai-sensitivity", JSON.stringify(state));
}
function sensitivityWord(name, value) {
  if (value <= 0) return "끄기";
  if (["입력 중 선검사", "확인 결과 재사용"].includes(name)) return "켜기";
  if (
    ["이미지 안전 안내", "대화 온도 타임라인", "대화 복구 문장"].includes(name)
  )
    return value >= 70 ? "민감하게" : "필요할 때";
  if (["표현 바꾸기", "감정 도움 AI"].includes(name))
    return value >= 75 ? "항상" : "필요할 때";
  if (name === "말맞춤 카드") return value >= 75 ? "넓게" : "약속 대화만";
  if (name === "대화 흐름 요약") return value >= 75 ? "항상" : "갈등 있을 때";
  if (name === "비꼼·압박 표현")
    return value < 35 ? "가볍게" : value < 70 ? "균형 있게" : "민감하게";
  if (name === "출처 확인 제안")
    return value < 35 ? "중요 정보만" : value < 70 ? "균형 있게" : "민감하게";
  return value < 35 ? "강한 표현만" : value < 70 ? "균형 있게" : "민감하게";
}
function roomAiConfig(id = roomId) {
  if (!id) return { mode: "inherit", checks: {} };
  try {
    const saved = JSON.parse(
      localStorage.getItem(roomPreferenceKey("ai", id)) || "{}",
    );
    return {
      mode: ["inherit", "off", "light", "standard", "careful"].includes(
        saved.mode,
      )
        ? saved.mode
        : "inherit",
      checks: saved.checks || {},
    };
  } catch {
    return { mode: "inherit", checks: {} };
  }
}
function saveRoomAiConfig(config, id = roomId) {
  if (!id) return;
  localStorage.setItem(roomPreferenceKey("ai", id), JSON.stringify(config));
  clearTimeout(aiPrefetch.timer);
  aiPrefetch = { text: "", result: null, promise: null, timer: null };
}
function activeAiIntervention() {
  const mode = roomAiConfig().mode;
  return mode === "inherit" ? aiIntervention : mode;
}
const aiDetails = (useRoomOverride = true) => {
  const state = sensitivityState();
  const details = Object.fromEntries(
    sensitivityKeys.map((key) => [
      key,
      sensitivityWord(key, state.categories[key]),
    ]),
  );
  const room = useRoomOverride ? roomAiConfig() : { mode: "inherit", checks: {} };
  if (room.mode === "off")
    return Object.fromEntries(sensitivityKeys.map((key) => [key, "끄기"]));
  const groups = {
    attack: ["강한 공격 표현"],
    tone: ["비꼼·압박 표현"],
    source: ["출처 확인 제안"],
    flow: ["말맞춤 카드", "대화 흐름 요약", "대화 온도 타임라인", "대화 복구 문장"],
    help: ["감정 도움 AI", "표현 바꾸기"],
    image: ["이미지 안전 안내"],
  };
  Object.entries(groups).forEach(([group, keys]) => {
    if (room.checks[group] === false) keys.forEach((key) => (details[key] = "끄기"));
  });
  return details;
};
const sensitivityLabel = (value) =>
  value <= 20
    ? "매우 가볍게"
    : value <= 40
      ? "가볍게"
      : value <= 60
        ? "보통"
        : value <= 80
          ? "꼼꼼하게"
          : "매우 꼼꼼하게";
const interventionFromSensitivity = (value) =>
  value <= 0
    ? "off"
    : value <= 33
      ? "light"
      : value <= 66
        ? "standard"
        : "careful";
const roomPreferenceKey = (kind, id) =>
  `retone-${kind}-${signedInId || "guest"}-${id}`;
const roomRule = (id) => {
  const mode = roomAiConfig(id).mode;
  return { inherit: "내 기본 설정", off: "AI 끄기", light: "최소 개입", standard: "균형 있게", careful: "꼼꼼하게" }[mode];
};
const isRoomMuted = (id) =>
  localStorage.getItem(roomPreferenceKey("muted", id)) === "1";
const hasLeftRoom = (id) =>
  localStorage.getItem(roomPreferenceKey("left", id)) === "1";
const esc = (s) =>
  String(s || "").replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
const aiCacheKey = (text) =>
  `${activeAiIntervention()}|${JSON.stringify(aiDetails())}|${text.trim().toLowerCase()}`;
function savedAiResult(text) {
  const result = aiSavedResults[aiCacheKey(text)] || null;
  return result && (result.verdict === "PASS" || result.verdict === "WARN")
    ? result
    : null;
}
function rememberAiResult(text, result) {
  const key = aiCacheKey(text);
  aiSavedResults[key] = { ...result, source: "saved" };
  const keys = Object.keys(aiSavedResults);
  if (keys.length > 180)
    keys.slice(0, keys.length - 180).forEach((k) => delete aiSavedResults[k]);
  try {
    localStorage.setItem(
      "retone-ai-results-v1",
      JSON.stringify(aiSavedResults),
    );
  } catch {}
}
async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const r = await fetch(url, {
    ...options,
    headers,
  });
  if (!r.ok) throw new Error();
  if (r.status === 204) return {};
  return r.json();
}
function rail() {
  return `<aside class="rail"><div class="brand">Re:<i>Tone</i></div><p>더 나은 대화를 위한<br>새로운 작업 공간</p><nav><button class="${nav === "chat" ? "active" : ""}" onclick="nav='chat';home()">채팅</button><button class="${nav === "friends" ? "active" : ""}" onclick="nav='friends';friends()">친구</button><button onclick="settings()">설정</button></nav><small>${esc(signedIn || "Re:Tone")} · v2</small></aside>`;
}
async function home() {
  stopRoomPolling();
  data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
  roomId = null;
  const rooms = data.rooms.filter(
    (r) => !["science", "friends"].includes(r.id) && !hasLeftRoom(r.id),
  );
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>채팅</h1><button class="new-room" onclick="newRoom()">＋ 새 대화</button></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님, 반가워요.</h2><p>친구를 초대해 첫 대화를 시작해 보세요.</p></div><div class="dash"><section class="focus"><b>오늘의 공동 확인</b><span>채팅방에서 함께 확인할 일을 만들어 보세요.</span></section><section class="focus schedule"><b>다음 약속 <button onclick="newAppointment()">＋</button></b><span>친구들과 약속을 정하면 여기에 보여요.</span></section></div><div class="rooms">${rooms.length ? rooms.map((r) => `<button class="room" onclick="openRoom('${r.id}')"><span class="avatar">${esc(r.name[0])}</span><span class="copy"><b>${r.pinned ? "📌 " : ""}${esc(r.name)}</b><span>${esc(r.last)}</span></span>${r.unread ? `<span class="badge">${r.unread}</span>` : ""}</button>`).join("") : `<button class="empty-chat" onclick="newRoom()"><b>아직 대화가 없어요</b><span>친구를 초대하거나 단체 채팅을 만들어 보세요. ＋</span></button>`}</div></div></section></main>`;
}
async function openRoom(id) {
  stopRoomPolling();
  roomId = id;
  const room = data.rooms.find((r) => r.id === id),
    messages = await api(
      `/api/rooms/${id}/messages?user_id=${encodeURIComponent(signedInId)}`,
    );
  currentRoomMessages = messages;
  const reflections = (data.reflections || []).filter(
    (item) => item.room_id === id,
  );
  const appointments = (data.appointments || []).filter(
    (item) => item.room_id === id,
  );
  const insights = (data.insights || []).filter(
    (item) =>
      item.room_id === id &&
      (item.has_conflict || aiDetails()["대화 흐름 요약"] === "항상"),
  );
  app.innerHTML = `<main class="layout">${rail()}<section class="chat"><header class="head"><button class="back-button" title="채팅 목록으로" aria-label="채팅 목록으로" onclick="home()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7M8 12h9"/></svg></button><div class="room-title"><h1>${esc(room.name)}</h1><span>참여자 ${room.members}명 · AI ${roomRule(id)} · ${isRoomMuted(id) ? "알림 끔" : "연결됨"}</span></div><div class="chat-actions"><button title="친구 초대" onclick="inviteFriends()">＋</button><button title="AI 도움받기" onclick="openAiHelp()">✦</button><button title="회고 카드" onclick="newReflection()">↻</button><button title="채팅방 설정" onclick="roomSettings()">⋯</button><button title="공동 확인" onclick="newAgreement()">✓</button></div></header><section class="messages" id="messages">${emotionTimeline(messages)}${toneCard(messages)}${insights.map(viewInsight).join("")}${messages.map(view).join("")}${alignmentCard(messages)}${appointments.map(viewAppointment).join("")}${reflections.map(viewReflection).join("")}${data.agreements
    .slice(0, 1)
    .map(
      (a) =>
        `<article class="agreement"><b>✓ 공동 확인 · ${esc(a.task)}</b><small>담당 ${esc(a.assignee)} · ${esc(a.deadline)} · 확인 ${a.confirmations} · 보완 ${a.revisions}</small><div><button onclick="answerAgreement('${a.id}','confirm')">확인했어요</button><button class="quiet" onclick="answerAgreement('${a.id}','revise')">보완 요청</button></div></article>`,
    )
    .join(
      "",
    )}</section><form class="sendbar" onsubmit="send(event)"><button type="button" class="intent-button" title="의도 표시" onclick="chooseIntent()">${selectedIntent ? "◎" : "＋"}</button><label class="image-upload" title="사진 보내기" aria-label="사진 보내기"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="m5.5 17 4.5-4 3.2 2.7 2.4-2 2.9 3.3"/></svg><input hidden type="file" accept="image/*" onchange="sendImage(this)"></label><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="queueAiCheck(this.value)"><span id="ai-status" class="ai-status"></span><button>↑</button></form></section></main>`;
  document.querySelector("#messages").scrollTop = 999999;
  startRoomPolling(id, messages);
  queueFactChecks(messages);
}
function stopRoomPolling() {
  if (roomPollTimer) {
    clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
}
function startRoomPolling(id, initialMessages) {
  let knownCount = initialMessages.length;
  let knownReactions = JSON.stringify(initialMessages.map((message) => [message.id, message.reactions || []]));
  roomPollTimer = setInterval(async () => {
    if (roomId !== id) return;
    try {
      const latest = await api(
        `/api/rooms/${id}/messages?user_id=${encodeURIComponent(signedInId)}`,
      );
      const latestReactions = JSON.stringify(latest.map((message) => [message.id, message.reactions || []]));
      if (latest.length !== knownCount || latestReactions !== knownReactions) {
        const incoming = latest.slice(knownCount).filter((message) => !message.mine);
        incoming.forEach((message) => notifyNewMessage(message));
        knownCount = latest.length;
        knownReactions = latestReactions;
        openRoom(id);
      }
    } catch {}
  }, 3500);
}
async function toggleBrowserNotifications() {
  if (!("Notification" in window)) return alert("이 브라우저에서는 알림을 지원하지 않아요.");
  const permission = await Notification.requestPermission();
  localStorage.setItem("retone-browser-notifications", permission === "granted" ? "1" : "0");
  settings();
}
function notifyNewMessage(message) {
  if (!browserNotificationsEnabled() || Notification.permission !== "granted" || isRoomMuted(roomId)) return;
  const room = data?.rooms?.find((item) => item.id === roomId);
  new Notification(room?.name || "Re:Tone", { body: `${message.sender}: ${message.body || "사진을 보냈어요."}`, tag: `retone-${roomId}` });
}
async function friends() {
  stopRoomPolling();
  const [users, relations] = await Promise.all([
    api("/api/users"),
    api(`/api/friends?user_id=${encodeURIComponent(signedInId)}`),
  ]);
  const known = new Set([
    ...relations.friends.map((user) => user.id),
    ...relations.incoming.map((user) => user.id),
    ...relations.outgoing.map((user) => user.id),
    ...relations.blocked.map((user) => user.id),
    signedInId,
  ]);
  const candidates = users.filter((user) => !known.has(user.id));
  const person = (user, action, detail) => `<article class="friend-row"><span class="avatar">${user.avatar_url ? `<img src="${user.avatar_url}" alt="">` : esc(user.name[0])}</span><span class="copy"><b>${esc(user.name)}</b><span>${detail}</span></span>${action}</article>`;
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><button class="new-room" onclick="home()">채팅 목록</button></header><div class="content"><div class="intro"><h2>내 친구</h2><p>친구 요청을 수락한 사람과만 1:1 채팅을 시작할 수 있어요.</p></div>${relations.incoming.length ? `<section class="friend-section"><b>받은 친구 요청 <em>${relations.incoming.length}</em></b><div>${relations.incoming.map((user) => person(user, `<button onclick="acceptFriend('${user.id}')">수락</button><button class="soft" onclick="blockFriend('${user.id}')">차단</button>`, "친구 요청을 보냈어요")).join("")}</div></section>` : ""}<section class="friend-section"><b>친구 ${relations.friends.length}</b><div>${relations.friends.length ? relations.friends.map((user) => person(user, `<button onclick="startDirect('${esc(user.name)}','${user.id}')">채팅</button><button class="soft" onclick="blockFriend('${user.id}')">차단</button>`, "1:1 대화를 시작할 수 있어요")).join("") : `<div class="empty-chat"><b>아직 친구가 없어요</b><span>아래에서 친구 요청을 보내보세요.</span></div>`}</div></section>${relations.outgoing.length ? `<section class="friend-section"><b>보낸 요청</b><div>${relations.outgoing.map((user) => person(user, `<span class="request-state">대기 중</span>`, "수락을 기다리고 있어요")).join("")}</div></section>` : ""}${candidates.length ? `<section class="friend-section"><b>친구 찾아보기</b><div>${candidates.map((user) => person(user, `<button onclick="requestFriend('${user.id}')">친구 요청</button>`, "Re:Tone에 가입했어요")).join("")}</div></section>` : ""}${relations.blocked.length ? `<details class="blocked-list"><summary>차단한 사용자 ${relations.blocked.length}명</summary><p>차단한 사용자는 친구 요청과 채팅을 시작할 수 없어요.</p></details>` : ""}</div></section></main>`;
}
async function requestFriend(id) {
  await api("/api/friends/request", { method: "POST", body: JSON.stringify({ user_id: signedInId, target_id: id }) });
  friends();
}
async function acceptFriend(id) {
  await api("/api/friends/accept", { method: "POST", body: JSON.stringify({ user_id: signedInId, target_id: id }) });
  friends();
}
async function blockFriend(id) {
  if (!confirm("이 사용자를 차단할까요? 친구 요청과 새 채팅을 할 수 없게 됩니다.")) return;
  await api("/api/blocks", { method: "POST", body: JSON.stringify({ user_id: signedInId, target_id: id }) });
  friends();
}
function roomSettings() {
  const muted = isRoomMuted(roomId);
  const config = roomAiConfig();
  const checks = [
    ["attack", "강한 공격 표현"],
    ["tone", "비꼼·압박 표현"],
    ["source", "출처 확인"],
    ["flow", "말맞춤·대화 흐름"],
    ["help", "표현 바꾸기·감정 도움"],
    ["image", "사진 안전 안내"],
  ];
  popup(
    `<div class="room-ai-settings"><span>이 채팅방만</span><h2>AI 도움 범위</h2><p>친한 친구 방은 최소 개입으로 두고, 중요한 방만 꼼꼼하게 설정할 수 있어요.</p><div class="room-ai-presets"><button class="${config.mode === "inherit" ? "selected" : ""}" onclick="setRoomAiMode('inherit')">내 기본 설정</button><button class="${config.mode === "off" ? "selected" : ""}" onclick="setRoomAiMode('off')">AI 끄기</button><button class="${config.mode === "light" ? "selected" : ""}" onclick="setRoomAiMode('light')">친한 사이 · 최소</button><button class="${config.mode === "careful" ? "selected" : ""}" onclick="setRoomAiMode('careful')">중요 대화 · 꼼꼼</button></div>${config.mode === "off" ? `<small>이 방에서는 전송 검사와 AI 제안을 하지 않아요.</small>` : `<div class="room-ai-checks">${checks.map(([key, label]) => `<label><input type="checkbox" ${config.checks[key] !== false ? "checked" : ""} onchange="toggleRoomAiCheck('${key}',this.checked)"><span>${label}</span></label>`).join("")}</div>`}<button class="room-muted-action" onclick="toggleRoomMute()">${muted ? "이 채팅방 알림 켜기" : "이 채팅방 알림 끄기"}</button><button class="danger-action" onclick="leaveRoom()">채팅방 나가기</button></div>`,
  );
}
function setRoomAiMode(mode) {
  const config = roomAiConfig();
  config.mode = mode;
  saveRoomAiConfig(config);
  closePopup();
  openRoom(roomId);
}
function toggleRoomAiCheck(key, enabled) {
  const config = roomAiConfig();
  config.checks[key] = enabled;
  saveRoomAiConfig(config);
}
function toggleRoomMute() {
  const key = roomPreferenceKey("muted", roomId);
  if (isRoomMuted(roomId)) localStorage.removeItem(key);
  else localStorage.setItem(key, "1");
  closePopup();
  openRoom(roomId);
}
async function leaveRoom() {
  if (!confirm("채팅방을 나갈까요? 나가면 이 방의 메시지를 더 볼 수 없어요.")) return;
  try {
    await api(`/api/rooms/${roomId}/leave?user_id=${encodeURIComponent(signedInId)}`, { method: "DELETE" });
    localStorage.removeItem(roomPreferenceKey("left", roomId));
    closePopup();
    home();
  } catch {
    alert("채팅방을 나가지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
async function startDirect(name, inviteeId = "") {
  const room = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      name,
      creator_id: signedInId,
      invitee_ids: inviteeId ? [inviteeId] : [],
    }),
  });
  data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
  openRoom(room.id);
}
function settings() {
  stopRoomPolling();
  nav = "settings";
  if (isAdmin) {
    app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>관리자</h1></header><div class="content"><div class="intro"><h2>Re:Tone 관리자 계정</h2><p>사용자별 계정과 AI 문의를 관리하는 공간이에요.</p></div><section class="admin-panel"><b>관리자 로그인 완료</b><span>일반 사용자 대화에는 관리자 권한이 자동으로 개입하지 않아요.</span><button onclick="openAdminReports()">AI 문의 확인</button></section><section class="admin-users"><div><b>가입 사용자</b><span>초기화할 계정을 개별로 선택하세요.</span></div><div id="admin-users-list" class="admin-users-list"><small>사용자 목록을 불러오는 중…</small></div></section><button class="room" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>관리자 세션을 안전하게 종료해요.</span></span></button></div></section></main>`;
    renderAdminUsers();
    return;
  }
  const avatar = localStorage.getItem("retone-avatar");
  const levels = {
    off: ["AI 끄기", "AI 점검을 사용하지 않아요"],
    light: ["가볍게", "강한 욕설만 빠르게 확인해요"],
    standard: ["균형 있게", "말투·출처가 중요한 주장만 확인해요"],
    careful: ["꼼꼼하게", "중요 정보와 표현을 조금 더 살펴봐요"],
  };
  const toggles = [
    ["강한 공격 표현", "필요한 경우만"],
    ["비꼼·압박 표현", "균형 있게"],
    ["출처 확인 제안", "중요한 정보만"],
    ["표현 바꾸기", "요청할 때만"],
    ["입력 중 선검사", "필요한 경우만"],
    ["감정 도움 AI", "요청할 때만"],
    ["확인 결과 재사용", "균형 있게"],
  ];
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>설정</h1></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님</h2><p>프로필과 앱 사용 환경을 관리해요.</p></div><div class="rooms"><label class="room"><span class="avatar">${avatar ? `<img src="${avatar}">` : esc(signedIn[0])}</span><span class="copy"><b>프로필 사진 바꾸기</b><span>사진을 선택하면 이 기기에서 바로 적용돼요.</span></span><input hidden type="file" accept="image/*" onchange="setAvatar(this)"></label><section class="ai-preferences"><b>AI 개입 정도</b><p>빠른 선택 또는 세부 항목을 조절할 수 있어요.</p><div>${Object.entries(
    levels,
  )
    .map(
      ([key, [title, desc]]) =>
        `<button class="ai-level ${aiIntervention === key ? "selected" : ""}" onclick="setAiIntervention('${key}')"><strong>${title}</strong><span>${desc}</span></button>`,
    )
    .join(
      "",
    )}</div><div class="ai-toggles">${toggles.map((t, i) => `<label><input type="checkbox" ${i < 6 ? "checked" : ""}>${t}</label>`).join("")}</div></section><button class="room" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>이 기기에서 안전하게 로그아웃해요.</span></span></button></div></div></section></main>`;
  renderDetailedAiSettings();
}
async function renderAdminUsers() {
  const root = document.querySelector("#admin-users-list");
  if (!root) return;
  try {
    const users = await api("/api/users");
    root.innerHTML = users.length
      ? users
          .map(
            (user) =>
              `<article><span class="avatar">${esc(user.name[0])}</span><b>${esc(user.name)}</b><button onclick="openAdminUserClear('${user.id}','${encodeURIComponent(user.name)}')">계정 초기화</button></article>`,
          )
          .join("")
      : `<small>초기화할 가입 사용자가 없어요.</small>`;
  } catch {
    root.innerHTML = `<small>사용자 목록을 불러오지 못했어요.</small>`;
  }
}
function openAdminReports() {
  popup(
    `<div class="admin-reports"><span>AI 문의 관리</span><h2>접수된 문의를 확인해요</h2><p>관리자 비밀번호와 2차 인증을 다시 입력하면 원문과 AI 결과를 볼 수 있어요.</p><input id="report-admin-password" type="password" placeholder="관리자 비밀번호"><input id="report-admin-two-factor" type="password" inputmode="numeric" placeholder="2차 인증 코드"><button onclick="loadAdminReports()">문의 불러오기</button></div>`,
  );
}
async function loadAdminReports() {
  const password = document.querySelector("#report-admin-password")?.value;
  const twoFactor = document.querySelector("#report-admin-two-factor")?.value;
  if (!password || !twoFactor) return alert("관리자 비밀번호와 2차 인증 코드를 입력해주세요.");
  try {
    const reports = await api(`/api/admin/reports?password=${encodeURIComponent(password)}&two_factor=${encodeURIComponent(twoFactor)}`);
    const rows = reports.length ? reports.map((report) => `<article><header><b>${esc(report.reporter_name)}</b><small>${esc(report.created)}</small></header><p><strong>원문</strong> ${esc(report.original_text)}</p>${report.ai_result ? `<p><strong>AI 결과</strong> ${esc(report.ai_result)}</p>` : ""}</article>`).join("") : `<div class="empty-chat"><b>접수된 문의가 없어요</b><span>사용자가 AI 제안에 문의하면 이곳에 표시돼요.</span></div>`;
    closePopup();
    popup(`<div class="admin-reports report-list"><span>AI 문의 관리</span><h2>접수된 문의</h2><div>${rows}</div><button onclick="closePopup()">닫기</button></div>`);
  } catch {
    alert("관리자 인증 정보가 맞지 않거나 문의를 불러오지 못했어요.");
  }
}
function openAdminUserClear(id, encodedName) {
  const name = decodeURIComponent(encodedName);
  popup(
    `<div class="ai-check warn"><span>관리자 작업</span><h2>${esc(name)} 계정을 초기화할까요?</h2><p>이 사용자의 계정과 해당 계정이 만든 채팅·약속 기록을 삭제합니다. AI 단어 확인 결과 캐시는 유지됩니다.</p><input id="admin-clear-password" type="password" placeholder="관리자 비밀번호를 입력해주세요"><input id="admin-clear-two-factor" type="password" inputmode="numeric" placeholder="2차 인증 코드를 입력해주세요"><button class="danger-action" onclick="clearSingleUser('${id}')">이 계정 초기화</button></div>`,
  );
}
async function clearSingleUser(id) {
  const password = document.querySelector("#admin-clear-password").value;
  const two_factor = document.querySelector("#admin-clear-two-factor").value;
  if (!password || !two_factor)
    return alert("관리자 비밀번호와 2차 인증 코드를 모두 입력해주세요.");
  try {
    const result = await api(`/api/admin/users/${id}/clear`, {
      method: "POST",
      body: JSON.stringify({ password, two_factor }),
    });
    if (!result.ok) throw new Error();
    closePopup();
    popup(
      `<div class="ai-check info"><h2>계정 초기화가 완료됐어요.</h2><p>선택한 사용자의 데이터만 삭제했고, AI 단어 확인 캐시는 유지했어요.</p><button onclick="closePopup();settings()">확인</button></div>`,
    );
  } catch {
    alert(
      "초기화하지 못했어요. 관리자 인증 정보 또는 서버 배포 상태를 확인해주세요.",
    );
  }
}
const aiCategories = [
  [
    "강한 공격 표현",
    "욕설·위협·강한 비하 표현을 살펴봐요.",
    ["끄기", "강한 표현만", "균형 있게", "민감하게"],
  ],
  [
    "비꼼·압박 표현",
    "빈정거림, 조롱, 상대를 몰아붙이는 말투를 살펴봐요.",
    ["끄기", "가볍게", "균형 있게", "민감하게"],
  ],
  [
    "출처 확인 제안",
    "건강·안전·돈처럼 중요한 정보의 출처를 제안해요.",
    ["끄기", "중요 정보만", "균형 있게", "민감하게"],
  ],
  [
    "표현 바꾸기",
    "AI가 제안한 문장을 더 부드럽게 바꾸는 버튼을 보여줘요.",
    ["끄기", "필요할 때", "항상"],
  ],
  [
    "입력 중 선검사",
    "입력을 멈췄을 때 미리 확인해 전송 대기를 줄여요.",
    ["끄기", "켜기"],
  ],
  [
    "감정 도움 AI",
    "답답하거나 서운할 때 마음을 정리할 공간을 보여줘요.",
    ["끄기", "필요할 때", "항상"],
  ],
  [
    "확인 결과 재사용",
    "같은 문장의 이전 확인 결과를 재사용해 API 사용을 줄여요.",
    ["끄기", "켜기"],
  ],
  [
    "말맞춤 카드",
    "약속·시간을 정하는 대화에서 일정 정리 카드를 제안해요.",
    ["끄기", "약속 대화만", "넓게"],
  ],
  [
    "대화 흐름 요약",
    "10개마다 실행하지만, 이어지는 주제는 최근 대화 흐름으로 함께 정리해요.",
    ["끄기", "갈등 있을 때", "항상"],
  ],
  [
    "이미지 안전 안내",
    "사진 전송 전 선정성·불쾌감 가능성을 안내해요. 경고 후에도 직접 선택해 보낼 수 있어요.",
    ["끄기", "필요할 때", "민감하게"],
  ],
  [
    "대화 온도 타임라인",
    "대화의 분위기 흐름을 작게 보여줘요. 알림이나 판단은 하지 않아요.",
    ["끄기", "필요할 때", "민감하게"],
  ],
  [
    "대화 복구 문장",
    "대화가 거칠어질 때만 조용히 보낼 문장 예시를 제안해요.",
    ["끄기", "필요할 때", "민감하게"],
  ],
];
const aiGroups = [
  [
    "대화 안전",
    "상대가 상처받을 수 있는 표현과 사진을 어느 정도까지 살펴볼지 정해요.",
    ["강한 공격 표현", "비꼼·압박 표현", "이미지 안전 안내"],
  ],
  [
    "정보와 표현",
    "출처 확인과 말 다듬기 도움을 설정해요.",
    ["출처 확인 제안", "표현 바꾸기"],
  ],
  [
    "빠른 사용",
    "AI가 작동하는 방식과 도움 기능을 정해요.",
    [
      "입력 중 선검사",
      "감정 도움 AI",
      "확인 결과 재사용",
      "말맞춤 카드",
      "대화 흐름 요약",
      "대화 온도 타임라인",
      "대화 복구 문장",
    ],
  ],
];
function renderDetailedAiSettings() {
  const root = document.querySelector(".ai-toggles");
  if (!root) return;
  const sensitivity = sensitivityState();
  const saved = aiDetails(false);
  const card = (name) => {
    const [, desc, options] = aiCategories.find(([title]) => title === name);
    return `<article class="ai-category"><span><b>${name}</b><small>${desc}</small></span><div class="ai-choice-row">${options.map((option) => `<button class="${saved[name] === option ? "selected" : ""}" onclick="saveAiDetail('${name}','${option}')">${option}</button>`).join("")}</div></article>`;
  };
  root.innerHTML = `<section class="overall-sensitivity"><span>기본 AI 민감도</span><b id="overall-sensitivity-label">${sensitivityLabel(sensitivity.overall)} · ${sensitivity.overall}</b><input type="range" min="0" max="100" value="${sensitivity.overall}" style="--sensitivity:${sensitivity.overall}%" oninput="previewOverallSensitivity(this.value,this)" onchange="setOverallSensitivity(this.value)"><small>모든 채팅방의 기본값이에요. 친한 친구 방은 방 설정에서 따로 낮출 수 있어요.</small></section><details class="ai-advanced-settings"><summary><span><b>세부 AI 항목 조절</b><small>필요할 때만 열어 항목별로 바꿔요.</small></span><i>⌄</i></summary><div class="ai-setting-intro"><b>세부 민감도는 AI가 조절해요</b><span>‘그냥 보내기’ 선택 패턴을 보고 항목별 수치를 조정합니다.</span></div>${aiGroups.map(([title, desc, names]) => `<details class="ai-setting-group"><summary><span><b>${title}</b><small>${desc}</small></span><i>⌄</i></summary><div class="ai-category-list">${names.map(card).join("")}</div></details>`).join("")}</details><section class="settings-actions"><button class="theme-toggle" onclick="toggleTheme()">${document.body.classList.contains("dark") ? "☀️ 라이트 모드" : "🌙 다크 모드"}</button><button class="notification-toggle" onclick="toggleBrowserNotifications()">${browserNotificationsEnabled() ? "🔔 새 메시지 알림 켬" : "🔕 새 메시지 알림 켜기"}</button><button class="danger-action" onclick="openDeleteAccount()">계정 삭제</button></section>`;
}
function saveAiDetail(name, value) {
  const state = sensitivityState();
  const map = {
    끄기: 0,
    가볍게: 25,
    "강한 표현만": 25,
    "중요 정보만": 25,
    "필요할 때": 50,
    "약속 대화만": 50,
    "갈등 있을 때": 50,
    "균형 있게": 50,
    켜기: 50,
    항상: 80,
    넓게: 80,
    민감하게: 85,
  };
  state.categories[name] = map[value] ?? 50;
  saveSensitivity(state);
  renderDetailedAiSettings();
}
function previewOverallSensitivity(value, input) {
  const label = document.querySelector("#overall-sensitivity-label");
  if (label)
    label.textContent = `${sensitivityLabel(Number(value))} · ${value}`;
  (
    input || document.querySelector(".overall-sensitivity input")
  ).style.setProperty("--sensitivity", `${value}%`);
}
async function setOverallSensitivity(value) {
  const state = sensitivityState(),
    next = Number(value);
  state.overall = next;
  sensitivityKeys.forEach((key) => {
    state.categories[key] = next;
  });
  saveSensitivity(state);
  aiIntervention = interventionFromSensitivity(next);
  sessionStorage.setItem("retone-v2-ai-level", aiIntervention);
  if (signedInId && !isAdmin) {
    try {
      await api(`/api/users/${signedInId}/preferences`, {
        method: "PATCH",
        body: JSON.stringify({ ai_intervention: aiIntervention }),
      });
    } catch {}
  }
  renderDetailedAiSettings();
}
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    "retone-theme",
    document.body.classList.contains("dark") ? "dark" : "light",
  );
  settings();
}
function openDeleteAccount() {
  popup(
    `<div class="delete-account-card"><div class="delete-account-icon">!</div><span>계정 삭제</span><h2>계정을 삭제할까요?</h2><p>이 작업은 되돌릴 수 없어요. 본인 확인을 위해 현재 이름과 비밀번호를 다시 입력해주세요.</p><label>현재 이름<input id="delete-name" placeholder="이름을 입력해주세요"></label><label>현재 비밀번호<input id="delete-password" type="password" placeholder="비밀번호를 입력해주세요"></label><small>삭제하면 로그인과 프로필 사용이 중단돼요.</small><div class="modal-actions"><button class="quiet" onclick="closePopup()">취소</button><button class="danger-action" onclick="deleteMyAccount()">계정 삭제</button></div></div>`,
  );
}
async function deleteMyAccount() {
  const name = document.querySelector("#delete-name").value.trim(),
    password = document.querySelector("#delete-password").value;
  if (!name || !password) return alert("이름과 비밀번호를 모두 입력해주세요.");
  try {
    await api(`/api/users/${signedInId}`, {
      method: "DELETE",
      body: JSON.stringify({ name, password }),
    });
    logout();
  } catch {
    alert(
      "이름 또는 비밀번호가 맞지 않아요. 현재 계정 정보를 다시 확인해주세요.",
    );
  }
}
if (localStorage.getItem("retone-theme") === "dark")
  document.body.classList.add("dark");
async function setAiIntervention(level) {
  if (!signedInId) return;
  const levelToSensitivity = { off: 0, light: 25, standard: 50, careful: 75 };
  const next = levelToSensitivity[level] ?? 50;
  const state = sensitivityState();
  state.overall = next;
  sensitivityKeys.forEach((key) => {
    state.categories[key] = next;
  });
  saveSensitivity(state);
  const user = await api(`/api/users/${signedInId}/preferences`, {
    method: "PATCH",
    body: JSON.stringify({ ai_intervention: level }),
  });
  aiIntervention = user.ai_intervention;
  sessionStorage.setItem("retone-v2-ai-level", aiIntervention);
  settings();
}
function logout() {
  stopRoomPolling();
  [
    "retone-v2-name",
    "retone-v2-user-id",
    "retone-v2-session",
    "retone-v2-ai-level",
    "retone-v2-admin",
  ].forEach((k) => sessionStorage.removeItem(k));
  signedIn = "";
  signedInId = "";
  sessionToken = "";
  isAdmin = false;
  start();
}
function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type.startsWith("image/") || file.size > 2_000_000)
      return reject(new Error("사진 파일만 2MB 이하로 선택해주세요."));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function saveAvatar(dataUrl, overrideWarning = false) {
  const out = await api(`/api/users/${signedInId}/avatar`, {
    method: "POST",
    body: JSON.stringify({
      data_url: dataUrl,
      override_warning: overrideWarning,
    }),
  });
  if (!out.saved) {
    const legal = out.sexual
      ? "선정적 이미지로 보일 수 있어 법률·플랫폼 규정 문제가 생길 수 있어요. Re:Tone은 법적 판단을 하지 않으며, 선택과 책임은 사용자에게 있어요."
      : "불쾌감이나 유해 가능성이 있는 이미지로 보일 수 있어요.";
    const token = encodeURIComponent(dataUrl);
    return popup(
      `<div class="ai-check warn"><span>프로필 사진 안내</span><h2>이 사진은 이렇게 보일 수 있어요</h2><p>${legal}</p><div class="modal-actions"><button class="quiet" onclick="closePopup()">다른 사진 고르기</button><button onclick="saveAvatar(decodeURIComponent('${token}'),true)">그래도 등록</button></div></div>`,
    );
  }
  localStorage.setItem("retone-avatar", out.avatar_url);
  closePopup();
  settings();
}
async function setAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    popup(
      `<div class="ai-check info"><span>프로필 사진 확인</span><h2>사진을 안전하게 확인 중이에요</h2><p>필요한 경우에만 안내를 띄우고, 최종 선택은 내가 해요.</p></div>`,
    );
    const dataUrl = await readImage(file);
    if (aiDetails()["이미지 안전 안내"] === "끄기")
      return saveAvatar(dataUrl, true);
    await saveAvatar(dataUrl);
  } catch {
    closePopup();
    popup(
      `<div class="ai-check warn"><h2>사진을 등록하지 못했어요</h2><p>2MB 이하의 이미지 파일인지, AI 안전 점검 연결 상태를 확인해주세요.</p><button onclick="closePopup()">확인</button></div>`,
    );
  }
}
function likelyFactualClaim(text) {
  const value = String(text || "").trim();
  if (value.length < 12 || value.includes("?")) return false;
  return /\d|%|원|만원|억|조|통계|연구|조사|발표|뉴스|속보|확진|재난|지진|태풍|지원금|대출|투자|주식|법|정책|선거|건강|질병|치료|사망|발생|이라고|라는데|래|된다|했대/.test(value);
}
function saveFactFindings() {
  const entries = Object.entries(factFindings).slice(-120);
  factFindings = Object.fromEntries(entries);
  try {
    localStorage.setItem("retone-fact-findings-v1", JSON.stringify(factFindings));
  } catch {}
}
async function queueFactChecks(messages) {
  if (aiDetails()["출처 확인 제안"] === "끄기") return;
  const candidates = messages
    .filter((message) => !message.mine && likelyFactualClaim(message.body))
    .slice(-3);
  for (const message of candidates) {
    if (factFindings[message.id] || factChecksInFlight.has(message.id)) continue;
    factChecksInFlight.add(message.id);
    try {
      const result = await api("/api/ai/fact-check", {
        method: "POST",
        body: JSON.stringify({ text: message.body }),
      });
      factFindings[message.id] = result;
      saveFactFindings();
      if (roomId === message.room_id && result.status === "check") openRoom(roomId);
    } catch {
      // 연결 실패는 조용히 넘기며, 사용자가 다시 눌러 확인할 수 있게 둡니다.
    } finally {
      factChecksInFlight.delete(message.id);
    }
  }
}
function view(m) {
  const finding = !m.mine ? factFindings[m.id] : null;
  const factCue =
    finding?.status === "check"
      ? `<button class="fact-cue" title="출처 확인 안내" onclick="event.stopPropagation();openFactFinding('${m.id}')">ⓘ</button>`
      : "";
  const reactions = m.reactions || [];
  const reactionNames = { "👍": "좋아요", "❤️": "하트", "😂": "웃겨요", "👏": "박수" };
  const reactionBar = `<div class="reaction-bar" onclick="event.stopPropagation()"><div class="reaction-list">${reactions.map((reaction) => `<button class="reaction-count ${reaction.mine ? "mine" : ""}" title="${reactionNames[reaction.emoji] || "반응"}" onclick="toggleReaction('${m.room_id}','${m.id}','${reaction.emoji}')">${reaction.emoji}<b>${reaction.count}</b></button>`).join("")}</div><div class="reaction-picker">${["👍", "❤️", "😂", "👏"].map((emoji) => `<button title="${reactionNames[emoji]}" aria-label="${reactionNames[emoji]}" onclick="toggleReaction('${m.room_id}','${m.id}','${emoji}')">${emoji}</button>`).join("")}</div></div>`;
  return `<article class="bubble ${m.mine ? "mine" : ""}" ${m.mine ? "" : `onclick="inspectMessage(${JSON.stringify(m.body)})"`}><div class="meta">${esc(m.sender)}${m.intent ? ` · <span class="intent-tag">${esc(m.intent)}</span>` : ""}</div>${m.image_url ? `<img class="chat-image" src="${m.image_url}" alt="보낸 사진">` : ""}${m.body ? `<span>${esc(m.body)}</span>` : ""}${factCue}${m.mine && m.unread ? `<span class="read">${m.unread}</span>` : ""}${m.mine ? `<button class="delete-message" title="메시지 삭제" onclick="removeMessage('${m.id}')">×</button>` : ""}${reactionBar}</article>`;
}
async function toggleReaction(room, message, emoji) {
  try {
    await api(`/api/rooms/${room}/messages/${message}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
    if (roomId === room) openRoom(room);
  } catch {
    alert("반응을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
function toneCard(messages) {
  const joined = messages.map((message) => message.body).join(" ");
  const tense =
    /(시발|씨발|병신|꺼져|죽어|닥쳐|최악|짜증|한심|왜이래|뭐하냐)/.test(joined);
  const careful = /(근데|아니|왜|서운|답답|미안|오해)/.test(joined);
  const tone = tense
    ? [
        "조심스러움",
        "최근 대화에 강한 표현이 있었어요. 누가 문제인지 정하지 않고, 서로의 의도를 한 번 확인해 볼까요?",
      ]
    : careful
      ? [
          "오해 가능성",
          "조금 다른 뜻으로 읽힐 수 있는 대화예요. 필요하면 의도 확인이나 갈등 전환 카드를 열어 보세요.",
        ]
      : ["편안함", "현재 대화는 비교적 편안하게 이어지고 있어요."];
  return `<button class="tone-card ${tense ? "careful" : ""}" onclick="openConflictGuide()"><span>대화 온도 · ${tone[0]}</span><b>${tone[1]}</b><small>누구를 평가하지 않는 대화 흐름 안내 · 눌러서 함께 정리하기</small></button>`;
}
function emotionTimeline(messages) {
  if (aiDetails()["대화 온도 타임라인"] === "끄기" || messages.length < 3)
    return "";
  const recent = messages.slice(-8);
  const score = (text) =>
    /(고마워|좋아|괜찮|미안|축하|ㅎㅎ|ㅋㅋ|도와|수고)/.test(text)
      ? 1
      : /(시발|씨발|병신|꺼져|죽어|닥쳐|짜증|최악|한심|왜이래|뭐하냐)/.test(
            text,
          )
        ? -2
        : /(근데|아니|왜|서운|답답|오해)/.test(text)
          ? -1
          : 0;
  const points = recent.map((m) => score(m.body || ""));
  const average = points.reduce((sum, value) => sum + value, 0) / points.length;
  const label =
    average <= -1 ? "조금 조심스러움" : average >= 0.5 ? "편안함" : "차분함";
  const recovery =
    average <= -1 &&
    aiDetails()["대화 복구 문장"] !== "끄기" &&
    !localStorage.getItem(`retone-recovery-dismissed-${roomId}`)
      ? `<button onclick="fillRecoveryMessage()">부드럽게 이어가기</button><i onclick="dismissRecoveryMessage()">×</i>`
      : "";
  return `<section class="emotion-timeline" title="최근 메시지의 단어 흐름을 단순히 요약한 표시예요. 누구의 감정이나 잘잘못을 판단하지 않아요."><span>대화 온도 · ${label}</span><div>${points.map((point) => `<i class="${point < 0 ? "low" : point > 0 ? "high" : "mid"}"></i>`).join("")}</div>${recovery}</section>`;
}
function fillRecoveryMessage() {
  const input = document.querySelector("#text");
  if (input) {
    input.value =
      "내 의도는 비난이 아니었어. 잠깐 정리하고 다시 이야기해도 될까?";
    input.focus();
  }
}
function dismissRecoveryMessage() {
  localStorage.setItem(`retone-recovery-dismissed-${roomId}`, "1");
  openRoom(roomId);
}
async function openConflictGuide() {
  popup(
    `<div class="ai-check info analysis-loading"><div class="thinking-loader" aria-label="AI 분석 중"><i></i><i></i><i></i></div><span>대화 흐름 분석 중</span><h2>최근 맥락을 살펴보고 있어요</h2><p>누가 맞는지 판단하지 않고, 지금 대화의 주제와 엇갈릴 수 있는 지점만 정리해요.</p><small>AI가 생각하고 있어요</small></div>`,
  );
  try {
    const result = await api("/api/ai/conversation-analysis", {
      method: "POST",
      body: JSON.stringify({
        messages: currentRoomMessages
          .slice(-20)
          .map((message) => `${message.sender}: ${message.body}`),
      }),
    });
    closePopup();
    const reason = result.reason
      ? `<p><strong>엇갈릴 수 있는 지점</strong><br>${esc(result.reason)}</p>`
      : `<p><strong>지금 흐름</strong><br>뚜렷한 갈등 신호는 보이지 않아요. 필요할 때만 아래 제안을 참고해 보세요.</p>`;
    pendingAnalysisDraft = result.draft || "";
    const draft = pendingAnalysisDraft
      ? `<button class="quiet" onclick="useAnalysisDraft()">입력창에 넣기</button>`
      : "";
    popup(
      `<div class="ai-check info conversation-analysis"><span>대화 온도 · ${esc(result.tone || "대화 흐름 정리")}</span><h2>최근 대화를 이렇게 읽을 수 있어요</h2><p>${esc(result.summary || "최근 대화를 함께 정리해 봐요.")}</p>${reason}<p><strong>이렇게 해보면 좋아요</strong><br>${esc(result.suggestion || "서로의 의도를 한 문장으로 확인해 보세요.")}</p><small>이 분석은 사람이나 감정을 확정하지 않는 참고용 제안이에요.</small><div class="modal-actions">${draft}<button onclick="closePopup()">확인</button></div></div>`,
    );
  } catch {
    closePopup();
    popup(
      `<div class="ai-check info"><span>대화 흐름 분석</span><h2>지금은 분석을 불러오지 못했어요</h2><p>잠시 후 다시 눌러보거나, 상대에게 “내 말이 어떻게 들렸는지 알려줄래?”라고 먼저 물어보세요.</p><button onclick="closePopup()">확인</button></div>`,
    );
  }
}
function useAnalysisDraft() {
  closePopup();
  const input = document.querySelector("#text");
  if (!input) return;
  input.value = pendingAnalysisDraft;
  input.focus();
  queueAiCheck(pendingAnalysisDraft);
}
function chooseConflictPath(path) {
  const copy = {
    "사실 정리": "서로 기억하는 사실을 짧게 적어볼까요?",
    "감정 먼저": "‘나는 …해서 서운했어’처럼 내 감정부터 말해볼까요?",
    "다음 행동": "지금 할 수 있는 작은 다음 행동을 정해볼까요?",
  }[path];
  popup(
    `<div class="ai-check info"><span>${path}</span><h2>${copy}</h2><p>필요하다면 이 내용을 공동 확인 카드로 바로 남길 수 있어요.</p><button onclick="closePopup();newAgreement()">공동 확인으로 만들기</button><button class="quiet" onclick="closePopup()">채팅으로 돌아가기</button></div>`,
  );
}
function chooseIntent() {
  popup(
    `<div class="ai-check info"><span>의도 확인</span><h2>이 메시지를 어떤 마음으로 보내나요?</h2><p>상대가 내 말을 추측하지 않도록, 선택한 의도를 메시지에 함께 표시해요.</p><div class="choice-stack">${["진지한 요청", "가벼운 농담", "서운한 마음", "재촉이 아닌 확인"].map((intent) => `<button onclick="setIntent('${intent}')">${intent}</button>`).join("")}</div><button class="quiet" onclick="setIntent('')">의도 없이 보내기</button></div>`,
  );
}
function setIntent(intent) {
  selectedIntent = intent;
  closePopup();
  const button = document.querySelector(".intent-button");
  if (button) button.textContent = intent ? "◎" : "＋";
}
function viewReflection(item) {
  return `<article class="reflection-card"><span>↻ 약속 회고</span><b>${esc(item.title)}</b><p><strong>계속할 점</strong> ${esc(item.keep || "아직 작성하지 않았어요")}</p><p><strong>다음에는</strong> ${esc(item.next || "아직 작성하지 않았어요")}</p></article>`;
}
function viewAppointment(item) {
  return `<article class="appointment-card"><span>◷ 말맞춤 약속</span><b>${esc(item.title)}</b><p><strong>${esc(item.date)}</strong>${item.place ? ` · ${esc(item.place)}` : ""}</p></article>`;
}
function setQuickDate(inputId, offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(18, 0, 0, 0);
  const value = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  const input = document.querySelector(`#${inputId}`);
  if (input) input.value = value;
}
function viewInsight(item) {
  return `<article class="insight-card"><span>✦ 대화 흐름 말맞춤 · ${esc(item.topic || "대화 흐름")}</span><b>${esc(item.summary)}</b><p><strong>엇갈린 지점</strong> ${esc(item.reason)}</p><p><strong>이렇게 풀어볼까요?</strong> ${esc(item.suggestion)}</p><button onclick="openConflictGuide()">갈등 전환 모드 열기</button></article>`;
}
function alignmentCard(messages) {
  if (aiDetails()["말맞춤 카드"] === "끄기") return "";
  const message = [...messages]
    .reverse()
    .find(
      (item) =>
        item.alignment_hint &&
        localStorage.getItem(`retone-alignment-dismissed-${item.id}`) !== "1",
    );
  if (!message) return "";
  return `<article class="alignment-card"><span>✦ 말맞춤 제안</span><b>약속을 정하는 대화 같아요.</b><p>‘${esc(message.body)}’에 대해 시간·장소·할 일을 함께 맞춰볼까요?</p><div><button onclick="openAlignmentCard('${message.id}')">말맞춤 카드 만들기</button><button class="quiet" onclick="dismissAlignment('${message.id}')">나중에</button></div></article>`;
}
function dismissAlignment(id) {
  localStorage.setItem(`retone-alignment-dismissed-${id}`, "1");
  openRoom(roomId);
}
function openAlignmentCard(id) {
  popup(
    `<div class="ai-check info"><span>말맞춤 카드</span><h2>약속을 함께 맞춰볼까요?</h2><p>상대의 의도를 추측하지 않고, 시간·장소·목적을 한 번에 정리해요.</p><input id="alignment-title" placeholder="무엇을 할지 입력해주세요"><div class="quick-date"><button type="button" onclick="setQuickDate('alignment-date',0)">오늘</button><button type="button" onclick="setQuickDate('alignment-date',1)">내일</button></div><input id="alignment-date" type="datetime-local"><input id="alignment-place" placeholder="장소 또는 온라인 링크를 입력해주세요"><button onclick="saveAlignmentCard('${id}')">약속 카드 만들기</button></div>`,
  );
}
async function saveAlignmentCard(messageId) {
  const title = document.querySelector("#alignment-title").value.trim(),
    date = document.querySelector("#alignment-date").value;
  if (!title || !date) return alert("무엇을 할지와 시간을 입력해주세요.");
  await api("/api/appointments", {
    method: "POST",
    body: JSON.stringify({
      title,
      room_id: roomId,
      date: date.replace("T", " "),
      place: document.querySelector("#alignment-place").value.trim(),
    }),
  });
  localStorage.setItem(`retone-alignment-dismissed-${messageId}`, "1");
  closePopup();
  data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
  openRoom(roomId);
}
function inspectMessage(text) {
  popup(
    `<div class="ai-check info"><span>상대 메시지</span><h2>이 메시지를 함께 살펴볼까요?</h2><p>Re:Tone은 진실·거짓을 판정하지 않고, 확인에 필요한 단서를 제안해요.</p><button onclick="factCheck(${JSON.stringify(text)})">사실여부 확인 도움받기</button></div>`,
  );
}
function safeLink(url) {
  const value = String(url || "");
  return /^https?:\/\//i.test(value) ? value.replace(/"/g, "%22") : "";
}
function factFindingMarkup(result) {
  const sources = (result.sources || [])
    .map((source) => {
      const url = safeLink(source.url);
      if (!url) return "";
      return `<a href="${url}" target="_blank" rel="noreferrer"><b>${esc(source.title || "출처 열기")}</b>${source.date ? `<small>${esc(source.date)}</small>` : ""}<span>열기 ↗</span></a>`;
    })
    .join("");
  return `<div class="ai-check info fact-finding"><span>출처 확인 안내</span><h2>한 번 더 확인해 볼까요?</h2><p>${esc(result.summary || "서로 다른 출처와 게시 날짜를 함께 확인해 보세요.")}</p>${sources ? `<div class="fact-sources">${sources}</div>` : ""}<small>이 표시는 사람이나 메시지를 판정하지 않으며, 출처가 부족하거나 엇갈릴 때만 보여요.</small><button onclick="closePopup()">확인</button></div>`;
}
function openFactFinding(id) {
  const result = factFindings[id];
  if (result) popup(factFindingMarkup(result));
}
async function factCheck(text) {
  const result = await api("/api/ai/fact-check", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  if (result.status === "check") return popup(factFindingMarkup(result));
  popup(`<div class="ai-check info"><span>출처 확인</span><h2>별도 안내가 필요하지 않아 보여요</h2><p>검색된 신뢰 가능한 출처들이 현재 문장을 대체로 뒷받침했어요. 그래도 중요한 결정 전에는 원문과 날짜를 확인해 주세요.</p><button onclick="closePopup()">확인</button></div>`);
}
function openAiHelp() {
  if (aiDetails()["감정 도움 AI"] === "끄기") return;
  popup(
    `<div class="ai-check info"><span>AI 도움받기</span><h2>지금 마음이나 전하고 싶은 말을 적어봐요</h2><textarea id="ai-help-text" placeholder="예: 너무 서운한데 싸우고 싶진 않아"></textarea><button onclick="askAiHelp()">AI와 이야기하기</button></div>`,
  );
}
async function askAiHelp() {
  const text = document.querySelector("#ai-help-text")?.value.trim();
  if (!text) return;
  const out = await api("/api/ai/support", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  popup(
    `<div class="ai-check info"><span>AI 도움받기</span><h2>이렇게 말해볼 수도 있어요</h2><p>${esc(out.reply || "지금 느끼는 마음을 차분히 적어보는 것부터 시작해 봐요.").replace(/\n/g, "<br>")}</p><button onclick="closePopup()">확인</button></div>`,
  );
}
function setAiStatus(text, working = false) {
  const status = document.querySelector("#ai-status");
  if (status) {
    status.textContent = text;
    status.classList.toggle("working", working);
  }
}
function queueAiCheck(value) {
  const text = value.trim();
  clearTimeout(aiPrefetch.timer);
  if (
    activeAiIntervention() === "off" ||
    aiDetails()["입력 중 선검사"] === "끄기" ||
    !text
  ) {
    aiPrefetch = { text: "", result: null, promise: null, timer: null };
    setAiStatus("");
    return;
  }
  const saved = savedAiResult(text);
  if (saved) {
    aiPrefetch = { text, result: saved, promise: null, timer: null };
    setAiStatus("이전 확인 결과 사용");
    return;
  }
  if (aiPrefetch.text === text && (aiPrefetch.result || aiPrefetch.promise))
    return;
  aiPrefetch = {
    text,
    result: null,
    promise: null,
    timer: setTimeout(() => runAiCheck(text), 180),
  };
  setAiStatus("AI 확인 준비 중", true);
}
async function runAiCheck(text) {
  if (aiPrefetch.text !== text) return;
  setAiStatus("AI 확인 중", true);
  const request = api("/api/ai/check", {
    method: "POST",
    body: JSON.stringify({
      text,
      ai_intervention: activeAiIntervention(),
      details: aiDetails(),
    }),
  });
  aiPrefetch.promise = request;
  try {
    const result = await request;
    rememberAiResult(text, result);
    if (aiPrefetch.text === text) {
      aiPrefetch.result = result;
      aiPrefetch.promise = null;
      setAiStatus(
        result.source === "cache" ? "저장된 확인 결과 사용" : "AI 확인 완료",
      );
    }
  } catch {
    if (aiPrefetch.text === text) {
      aiPrefetch.promise = null;
      setAiStatus("");
    }
  }
}
async function checkForSend(body) {
  if (activeAiIntervention() === "off")
    return { verdict: "PASS", info: { level: "none" } };
  const saved = savedAiResult(body);
  if (saved) return saved;
  if (aiPrefetch.text === body && aiPrefetch.result) return aiPrefetch.result;
  if (aiPrefetch.text === body && aiPrefetch.promise) return aiPrefetch.promise;
  clearTimeout(aiPrefetch.timer);
  aiPrefetch = { text: body, result: null, promise: null, timer: null };
  return runAiCheck(body).then(
    () => aiPrefetch.result || { verdict: "PASS", info: { level: "none" } },
  );
}
function addPendingBubble(body) {
  const list = document.querySelector("#messages");
  if (!list) return;
  list.insertAdjacentHTML(
    "beforeend",
    `<article id="ai-pending" class="bubble mine pending"><div class="meta">나 · AI 확인 중</div>${esc(body)}</article>`,
  );
  list.scrollTop = list.scrollHeight;
}
function removePendingBubble() {
  document.querySelector("#ai-pending")?.remove();
}
async function send(event) {
  event.preventDefault();
  if (pendingSend) return;
  const input = document.querySelector("#text"),
    body = input.value.trim();
  if (!body) return;
  pendingSend = { body, room: roomId, intent: selectedIntent };
  input.value = "";
  input.disabled = true;
  const saved = activeAiIntervention() !== "off" && savedAiResult(body);
  input.placeholder =
    activeAiIntervention() === "off"
      ? "메시지를 보내고 있어요…"
      : saved
        ? "이전 확인 결과를 사용해요…"
        : "AI가 확인 중이에요…";
  addPendingBubble(body);
  try {
    showCheckResult(await checkForSend(body));
  } catch {
    await sendApproved();
  }
}
async function sendImageNow(dataUrl) {
  await api(`/api/rooms/${roomId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      sender: signedIn,
      sender_id: signedInId,
      body: "사진을 보냈어요.",
      image_url: dataUrl,
    }),
  });
  openRoom(roomId);
}
async function sendImage(input) {
  const file = input.files[0];
  if (!file || !roomId) return;
  try {
    setAiStatus("사진을 안전하게 확인 중이에요…", true);
    const dataUrl = await readImage(file);
    if (aiDetails()["이미지 안전 안내"] !== "끄기") {
      const check = await api("/api/images/check", {
        method: "POST",
        body: JSON.stringify({ data_url: dataUrl }),
      });
      if (check.flagged) {
        const legal = check.sexual
          ? "선정적 이미지로 보일 수 있어 법률·플랫폼 규정 문제가 생길 수 있어요. Re:Tone은 법적 판단을 하지 않으며, 최종 선택과 책임은 사용자에게 있어요."
          : "상대에게 불쾌감이나 유해한 이미지로 보일 수 있어요.";
        const token = encodeURIComponent(dataUrl);
        popup(
          `<div class="ai-check warn"><span>사진 전송 안내</span><h2>이 사진은 이렇게 보일 수 있어요</h2><p>${legal}</p><div class="modal-actions"><button class="quiet" onclick="closePopup()">다른 사진 고르기</button><button onclick="closePopup();sendImageNow(decodeURIComponent('${token}'))">그래도 보내기</button></div></div>`,
        );
        return;
      }
    }
    await sendImageNow(dataUrl);
  } catch {
    popup(
      `<div class="ai-check warn"><h2>사진을 전송하지 못했어요</h2><p>2MB 이하의 이미지인지, AI 안전 점검 연결 상태를 확인해주세요.</p><button onclick="closePopup()">확인</button></div>`,
    );
  } finally {
    setAiStatus("");
    input.value = "";
  }
}
function showCheckResult(result) {
  if (!result || (result.verdict !== "PASS" && result.verdict !== "WARN")) {
    sendApproved();
    return;
  }
  if (pendingSend) pendingSend.result = result;
  const info = result.info || { level: "none", queries: [] };
  const suggestion = result.suggestion
    ? `<p class="ai-suggestion">${esc(result.suggestion)}</p>`
    : "";
  if (result.verdict === "WARN") {
    removePendingBubble();
    const rewrite =
      aiDetails()["표현 바꾸기"] === "끄기"
        ? ""
        : `<button class="quiet" onclick="rewritePending()">AI로 표현 바꾸기</button>`;
    popup(
      `<div class="ai-check warn"><span>Re:Tone의 제안</span><h2>이렇게 들릴 수도 있어요</h2>${suggestion || "<p>상대에게는 공격적인 표현으로 들릴 수 있어요. 조금 다르게 말해볼까요?</p>"}<small>Re:Tone은 이 문장을 판단하거나 막지 않아요. 선택은 언제나 나에게 있어요.</small><div class="modal-actions">${rewrite}<button onclick="sendDespiteWarning()">그냥 보내기</button></div><button class="report-ai" onclick="reportAiResult()">AI 제안이 이상했나요? 문의하기</button></div>`,
    );
    return;
  }
  if (info.level === "check") {
    removePendingBubble();
    popup(
      `<div class="ai-check info"><span>Re:Tone의 제안</span><h2>출처를 함께 적어볼까요?</h2><p>${esc(info.note || "이 내용은 출처와 작성 날짜를 함께 확인해 보면 더 정확하게 전달될 수 있어요.")}</p>${(info.queries || []).length ? `<ul>${info.queries.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}<small>Re:Tone은 이 정보의 진실·거짓을 판단하지 않아요.</small><div class="modal-actions"><button class="quiet" onclick="editPendingSend()">내용 보완하기</button><button onclick="sendApproved()">이대로 보내기</button></div><button class="report-ai" onclick="reportAiResult()">AI 제안이 이상했나요? 문의하기</button></div>`,
    );
    return;
  }
  sendApproved();
}
function sendDespiteWarning() {
  if (pendingSend?.result?.verdict === "WARN") {
    const state = sensitivityState();
    const category =
      pendingSend.result.source === "dictionary"
        ? "강한 공격 표현"
        : "비꼼·압박 표현";
    state.overrides[category] = (state.overrides[category] || 0) + 1;
    if (state.overrides[category] >= 3) {
      state.categories[category] = Math.max(0, state.categories[category] - 5);
      state.overrides[category] = 0;
    }
    saveSensitivity(state);
  }
  sendApproved();
}
async function rewritePending() {
  if (!pendingSend) return;
  const button = document.querySelector(".modal-actions .quiet");
  if (button) {
    button.disabled = true;
    button.textContent = "표현을 다듬는 중…";
  }
  try {
    const out = await api("/api/ai/rewrite", {
      method: "POST",
      body: JSON.stringify({
        text: pendingSend.body,
        context: currentRoomMessages
          .slice(-12)
          .map((message) => `${message.sender}: ${message.body}`),
      }),
    });
    if (out.suggestion) {
      pendingSend.body = out.suggestion;
      editPendingSend();
    } else {
      button.textContent = "표현 바꾸기";
    }
  } catch {
    button.textContent = "표현 바꾸기";
  }
}
async function reportAiResult() {
  if (!pendingSend) return;
  await api("/api/ai/reports", {
    method: "POST",
    body: JSON.stringify({
      reporter_name: signedIn,
      original_text: pendingSend.body,
      ai_result: JSON.stringify(pendingSend.result || {}),
    }),
  });
  popup(
    '<div class="ai-check info"><h2>문의가 전달됐어요</h2><p>관리자 계정에서 AI 제안과 원문을 확인할 수 있어요. 보내기 여부는 그대로 선택할 수 있어요.</p><button onclick="closePopup()">확인</button></div>',
  );
}
async function sendApproved() {
  if (!pendingSend) return;
  const next = pendingSend;
  closePopup();
  setAiStatus("");
  try {
    await api(`/api/rooms/${next.room}/messages`, {
      method: "POST",
      body: JSON.stringify({
        sender: signedIn,
        sender_id: signedInId,
        body: next.body,
        intent: next.intent,
      }),
    });
  } catch {
    removePendingBubble();
    const input = document.querySelector("#text");
    if (input) {
      input.disabled = false;
      input.placeholder = "메시지를 입력하세요";
    }
    popup(
      `<div class="ai-check warn"><span>전송되지 않았어요</span><h2>메시지를 보내지 못했어요.</h2><p>인터넷 연결 또는 서버 상태를 확인한 뒤 다시 시도해주세요. 메시지 내용은 유지돼요.</p><div class="modal-actions"><button class="quiet" onclick="editPendingSend()">내용 다시 보기</button><button onclick="sendApproved()">다시 보내기</button></div></div>`,
    );
    return;
  }
  pendingSend = null;
  selectedIntent = "";
  openRoom(next.room);
  if (aiDetails()["대화 흐름 요약"] !== "끄기")
    api(`/api/rooms/${next.room}/insight`, { method: "POST" })
      .then(async () => {
        data = await api(
          `/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`,
        );
        if (roomId === next.room) openRoom(next.room);
      })
      .catch(() => {});
}
function editPendingSend() {
  const body = pendingSend?.body || "";
  // 경고창에서 입력창으로 돌아가는 것은 '취소'가 아니라 새 문장의 편집입니다.
  // 이 상태를 남겨두면 send()가 중복 전송 방지 분기에서 즉시 종료됩니다.
  pendingSend = null;
  clearTimeout(aiPrefetch.timer);
  aiPrefetch = { text: "", result: null, promise: null, timer: null };
  removePendingBubble();
  closePopup();
  const input = document.querySelector("#text");
  if (input) {
    input.disabled = false;
    input.placeholder = "메시지를 입력하세요";
    input.value = body;
    input.focus();
    queueAiCheck(body);
  }
}
async function removeMessage(id) {
  if (!confirm("이 메시지를 삭제할까요?")) return;
  await api(
    `/api/rooms/${roomId}/messages/${id}?user_id=${encodeURIComponent(signedInId)}`,
    { method: "DELETE" },
  );
  openRoom(roomId);
}
function popup(inner) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal" onclick="if(event.target===this){if(pendingSend){editPendingSend()}else this.remove()}"><section>${inner}</section></div>`,
  );
}
function closePopup() {
  document.querySelector(".modal")?.remove();
}
function newRoom() {
  popup(
    `<h2>새 단체 채팅</h2><p>팀·친구와 함께할 대화 공간을 만들어요.</p><input id="roomName" placeholder="예: 과학 수행평가 조"><button onclick="saveRoom()">채팅방 만들기</button>`,
  );
}
async function saveRoom() {
  const name = document.querySelector("#roomName").value.trim();
  if (!name) return;
  await api("/api/rooms", { method: "POST", body: JSON.stringify({ name }) });
  closePopup();
  home();
}
function newAgreement() {
  popup(
    `<h2>공동 확인 만들기</h2><p>할 일, 담당자, 기한을 함께 확인해요.</p><input id="task" placeholder="할 일"><input id="assignee" placeholder="담당자"><input id="deadline" placeholder="예: 내일 18:00"><button onclick="saveAgreement()">공동 확인 카드 만들기</button>`,
  );
}
async function saveAgreement() {
  const task = document.querySelector("#task").value.trim();
  if (!task) return;
  await api("/api/agreements", {
    method: "POST",
    body: JSON.stringify({
      task,
      room_id: roomId,
      assignee: document.querySelector("#assignee").value,
      deadline: document.querySelector("#deadline").value,
    }),
  });
  closePopup();
  openRoom(roomId);
}
function popup(inner) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal" onclick="if(event.target===this){if(pendingSend){editPendingSend()}else this.remove()}"><section>${inner}</section></div>`,
  );
}
function closePopup() {
  document.querySelector(".modal")?.remove();
}
async function newRoom() {
  const users = (await api(`/api/friends?user_id=${encodeURIComponent(signedInId)}`)).friends;
  popup(
    `<h2>새 단체 채팅</h2><p>방 이름을 정하고, 가입한 친구를 바로 초대할 수 있어요.</p><input id="roomName" placeholder="예: 과학 수행평가 조"><div class="invite-list">${users.length ? users.map((user) => `<label><input type="checkbox" class="invite-user" value="${user.id}"> <b>${esc(user.name)}</b> 초대</label>`).join("") : "<small>가입한 다른 친구가 아직 없어요.</small>"}</div><button onclick="saveRoom()">채팅방 만들기</button>`,
  );
}
function selectedInvitees() {
  return [...document.querySelectorAll(".invite-user:checked")].map(
    (input) => input.value,
  );
}
async function inviteFriends() {
  const users = (await api(`/api/friends?user_id=${encodeURIComponent(signedInId)}`)).friends;
  popup(
    `<h2>친구 초대</h2><p>친구를 고르면 참여 안내가 표시돼요.</p><div class="invite-list">${users.length ? users.map((user) => `<label><input type="checkbox" class="invite-user" value="${user.id}"> <b>${esc(user.name)}</b></label>`).join("") : "<small>초대할 가입 친구가 없어요.</small>"}</div><button onclick="confirmInviteFriends()">선택한 친구 초대</button>`,
  );
}
async function confirmInviteFriends() {
  const inviteeIds = selectedInvitees();
  if (!inviteeIds.length) return alert("초대할 친구를 한 명 이상 골라 주세요.");
  try {
    await api(`/api/rooms/${roomId}/members`, {
      method: "POST",
      body: JSON.stringify({ inviter_id: signedInId, invitee_ids: inviteeIds }),
    });
    data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
    closePopup();
    openRoom(roomId);
  } catch (error) {
    alert("친구를 초대하지 못했어요. 친구 상태와 채팅방 참여 상태를 다시 확인해주세요.");
  }
}
async function saveRoom() {
  const name = document.querySelector("#roomName").value.trim();
  if (!name) return;
  await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      name,
      creator_id: signedInId,
      invitee_ids: selectedInvitees(),
    }),
  });
  closePopup();
  home();
}
function newAgreement() {
  popup(
    `<h2>공동 확인 만들기</h2><p>할 일, 담당자, 기한을 함께 확인해요.</p><input id="task" placeholder="할 일"><input id="assignee" placeholder="담당자"><input id="deadline" placeholder="예: 내일 18:00"><button onclick="saveAgreement()">공동 확인 카드 만들기</button>`,
  );
}
async function saveAgreement() {
  const task = document.querySelector("#task").value.trim();
  if (!task) return;
  await api("/api/agreements", {
    method: "POST",
    body: JSON.stringify({
      task,
      room_id: roomId,
      assignee: document.querySelector("#assignee").value,
      deadline: document.querySelector("#deadline").value,
    }),
  });
  closePopup();
  openRoom(roomId);
}
async function answerAgreement(id, action) {
  await api(`/api/agreements/${id}/${action}`, { method: "POST" });
  openRoom(roomId);
}
function newAppointment() {
  popup(
    `<h2>함께할 약속 잡기</h2><p>회의·보이스톡·만남 일정을 팀에 바로 공유해요.</p><input id="appointmentTitle" placeholder="예: 발표 방향 짧은 회의"><div class="quick-date"><button type="button" onclick="setQuickDate('appointmentDate',0)">오늘</button><button type="button" onclick="setQuickDate('appointmentDate',1)">내일</button></div><input id="appointmentDate" type="datetime-local"><input id="appointmentPlace" placeholder="장소 또는 채팅방"><button onclick="saveAppointment()">약속 공유하기</button>`,
  );
}
async function saveAppointment() {
  const title = document.querySelector("#appointmentTitle").value.trim(),
    date = document.querySelector("#appointmentDate").value;
  if (!title || !date) return;
  await api("/api/appointments", {
    method: "POST",
    body: JSON.stringify({
      title,
      room_id: roomId,
      date: date.replace("T", " "),
      place: document.querySelector("#appointmentPlace").value,
    }),
  });
  closePopup();
  home();
}
function newReflection() {
  popup(
    `<h2>약속 회고 카드</h2><p>회의나 공동 확인이 끝난 뒤, 다음 대화를 더 좋게 만들 수 있어요.</p><input id="reflection-title" placeholder="무엇을 함께 돌아볼까요?"><input id="reflection-keep" placeholder="계속할 점을 입력해주세요"><input id="reflection-next" placeholder="다음에는 어떻게 할지 입력해주세요"><button onclick="saveReflection()">회고 카드 남기기</button>`,
  );
}
async function saveReflection() {
  const title = document.querySelector("#reflection-title").value.trim();
  if (!title) return alert("돌아볼 내용을 입력해주세요.");
  await api("/api/reflections", {
    method: "POST",
    body: JSON.stringify({
      room_id: roomId,
      title,
      keep: document.querySelector("#reflection-keep").value.trim(),
      next: document.querySelector("#reflection-next").value.trim(),
    }),
  });
  closePopup();
  data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
  openRoom(roomId);
}
function showAiPolicy() {
  popup(
    `<div class="ai-policy"><span>Re:Tone AI 안내 · 2026.10</span><h2>내 대화를 돕기 위한 AI 사용</h2><p><b>왜 개입하나요?</b><br>강한 욕설·위협 표현, 오해될 수 있는 말투, 출처 확인이 중요한 건강·안전·법·금융·재난·속보성 주장을 알리기 위해서예요.</p><p><b>무엇을 보내나요?</b><br>사전에 없는 문장에 한해, 지금 입력한 메시지 한 개만 AI 점검에 사용해요. 다만 내가 ‘표현 바꾸기’를 누른 경우에만, 더 자연스러운 제안을 위해 같은 채팅방의 최근 대화 일부를 함께 참고해요. 다른 채팅방·전화번호·비밀번호·프로필은 보내지 않아요.</p><p><b>무엇을 하지 않나요?</b><br>사실을 거짓이라고 단정하거나, AI가 대신 전송하거나, 경고만으로 메시지를 막지 않아요. 최종 전송은 항상 내가 선택해요.</p><p><b>내가 조절할 수 있는 것</b><br>AI 끄기, 강한 표현만 확인, 균형 있게 확인, 꼼꼼한 확인을 설정에서 언제든 바꿀 수 있어요.</p><small>AI 점검 결과는 같은 문장을 빠르게 처리하기 위해 보관될 수 있으며, 설정에서 AI를 끄면 이후 점검을 멈춰요.</small><button onclick="closePopup()">확인했어요</button></div>`,
  );
}
function start() {
  if (signedIn && (!signedInId || (!isAdmin && !sessionToken))) {
    ["retone-v2-name", "retone-v2-user-id", "retone-v2-session", "retone-v2-ai-level"].forEach((key) => sessionStorage.removeItem(key));
    signedIn = "";
    signedInId = "";
    sessionToken = "";
  }
  // The administrator is not a database chat user. Restoring it through home()
  // would request a bootstrap for the synthetic "admin" id and hide the admin UI.
  if (signedIn && isAdmin) return settings();
  if (signedIn) return home();
  app.innerHTML = `<main class="auth"><section class="auth-showcase"><div class="showcase-brand">Re:<i>Tone</i></div><div class="showcase-copy"><span>TEAM COMMUNICATION, RE:IMAGINED</span><h1>말하기 전에 한 번,<br><em>이해한 뒤에 한 번.</em></h1><p>대화의 온도를 함께 살피고,<br>팀의 중요한 약속을 놓치지 않도록 도와줘요.</p></div><div class="showcase-preview"><div><b>프로젝트 팀 채팅</b><small>AI가 필요한 순간에만 조심스럽게 도와요</small></div><p>“이 부분은 이렇게 정리해 보면 더 잘 전달될 것 같아요.”</p><span>Re:Tone의 제안 · 선택은 언제나 내가</span></div></section><section class="auth-panel"><section class="auth-card"><div class="auth-brand">Re:<i>Tone</i></div><p class="auth-copy">대화와 약속을 더 편안하게 이어가요.</p><div class="auth-tabs"><button class="selected" onclick="authForm('login')">로그인</button><button onclick="authForm('signup')">회원가입</button></div><div id="auth-form"><label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" placeholder="전화번호를 입력하세요"></label><label>비밀번호<input id="auth-password" type="password" placeholder="비밀번호를 입력하세요"></label><button class="auth-submit" onclick="finishAuth('login')">로그인</button><button type="button" class="admin-login-link" onclick="authForm('admin')">관리자 로그인</button></div><small>더 나은 대화와 함께하는 작업 공간</small></section></section></main>`;
  authForm("login");
}
function authForm(mode) {
  const join = mode === "signup";
  document
    .querySelectorAll(".auth-tabs button")
    .forEach((b, i) => b.classList.toggle("selected", (i === 1) === join));
  if (join) {
    if (!signupAiDetails) signupAiDetails = { ...aiDetails() };
    if (!signupDraft)
      signupDraft = {
        step: 0,
        name: "",
        phone: "",
        password: "",
        sensitivity: 50,
        ai: "standard",
        consent: false,
      };
    renderSignupWizard();
    return;
  }
  if (mode === "admin") {
    document.querySelector("#auth-form").innerHTML =
      `<div class="admin-auth"><span>관리자 전용</span><h2>관리자 로그인</h2><p>비밀번호와 2차 인증 코드를 모두 입력해주세요.</p><label>관리자 비밀번호<input id="admin-password" type="password" placeholder="관리자 비밀번호를 입력해주세요"></label><label>2차 인증 코드<input id="admin-two-factor" inputmode="numeric" type="password" placeholder="2차 인증 코드를 입력해주세요"></label><button class="auth-submit" onclick="finishAdminLogin()">관리자 로그인</button><button type="button" class="admin-back" onclick="authForm('login')">일반 로그인으로 돌아가기</button></div>`;
    return;
  }
  if (join && !signupAiDetails) signupAiDetails = { ...aiDetails() };
  const signupCard = (name) => {
    const [, desc, options] = aiCategories.find(([title]) => title === name);
    return `<article class="signup-ai-category"><b>${name}</b><small>${desc}</small><div>${options.map((option) => `<button type="button" class="${signupAiDetails[name] === option ? "selected" : ""}" onclick="setSignupAiDetail(this,'${name}','${option}')">${option}</button>`).join("")}</div></article>`;
  };
  const categorySetup = `<details class="auth-ai-details" open><summary>항목별 AI 민감도 설정</summary><p>각 항목에서 AI가 어느 정도까지 도울지 정해요. 가입 후에도 바꿀 수 있어요.</p>${aiGroups.map(([title, , names]) => `<section class="signup-ai-group"><b>${title}</b>${names.map(signupCard).join("")}</section>`).join("")}</details>`;
  document.querySelector("#auth-form").innerHTML =
    `<label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" placeholder="전화번호를 입력하세요"></label><label>비밀번호<input id="auth-password" type="password" placeholder="비밀번호를 입력하세요"></label>${join ? `<label>AI 개입 정도<select id="auth-ai-level"><option value="light">가볍게 · 강한 욕설만</option><option value="standard" selected>균형 있게 · 말투와 중요한 정보</option><option value="careful">꼼꼼하게 · 더 세심한 확인</option><option value="off">AI 끄기</option></select></label>${categorySetup}<button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI가 개입하는 이유와 사용 범위 보기</button><label class="consent"><input id="auth-ai-consent" type="checkbox"> AI 사용 안내를 읽었고, 선택한 범위의 점검에 동의해요.</label><p class="auth-hint">동의하지 않아도 AI 끄기를 선택해 가입할 수 있고, 설정에서 언제든 변경할 수 있어요.</p>` : ""}<button class="auth-submit" onclick="finishAuth('${mode}')">${join ? "회원가입하고 시작하기" : "로그인"}</button>${join ? '<p class="auth-hint">같은 전화번호가 있으면 확인 절차가 안내돼요.</p>' : '<button type="button" class="admin-login-link" onclick="authForm(\'admin\')">관리자 로그인</button>'}`;
}
function renderSignupWizard() {
  const draft = signupDraft;
  const steps = ["계정", "AI 민감도", "확인"];
  const progress = `<div class="signup-progress"><span>${draft.step + 1} / ${steps.length}</span><b>${steps[draft.step]}</b><div><i style="width:${((draft.step + 1) / steps.length) * 100}%"></i></div></div>`;
  let content = "";
  if (draft.step === 0)
    content = `<h2>먼저 계정을 만들어요</h2><p>친구들과 안전하게 대화하기 위한 기본 정보예요.</p><label>이름<input id="signup-name" value="${esc(draft.name)}" placeholder="이름을 입력해주세요"></label><label>전화번호<input id="signup-phone" value="${esc(draft.phone)}" inputmode="numeric" oninput="checkSignupPhone()" placeholder="전화번호를 입력해주세요"><small id="signup-phone-status" class="field-status">전화번호를 입력하면 중복 여부를 바로 확인해요.</small></label><label>비밀번호<input id="signup-password" value="${esc(draft.password)}" type="password" oninput="checkPasswordRequirements()" placeholder="비밀번호를 입력해주세요"></label><ul class="password-requirements"><li id="password-length">○ 6자 이상</li><li id="password-letter">○ 영어 1자 이상</li><li id="password-special">○ 특수문자 1자 이상</li></ul>`;
  else if (draft.step === 1)
    content = `<h2>AI가 얼마나 도울까요?</h2><p>처음에는 보통(50)에서 시작해요. 이후 ‘그냥 보내기’ 선택 패턴을 보고 AI가 세부 민감도를 조절하며, 설정에서 언제든 바꿀 수 있어요.</p><section class="signup-sensitivity"><div><span>AI 민감도</span><b id="signup-sensitivity-label">${sensitivityLabel(draft.sensitivity)} · ${draft.sensitivity}</b></div><input type="range" min="0" max="100" value="${draft.sensitivity}" style="--sensitivity:${draft.sensitivity}%" oninput="previewSignupSensitivity(this.value,this)" onchange="setSignupSensitivity(this.value)"><small>낮을수록 필요한 순간에만, 높을수록 더 세심하게 제안해요.</small></section>`;
  else
    content = `<h2>마지막 확인이에요</h2><p>Re:Tone은 판단하거나 차단하지 않고, 선택한 범위에서만 대화를 돕습니다.</p><button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI가 개입하는 이유와 사용 범위 보기</button><label class="consent"><input id="signup-consent" type="checkbox" ${draft.consent ? "checked" : ""}> AI 사용 안내를 읽었고, 선택한 범위의 점검에 동의해요.</label><p class="auth-hint">AI 끄기를 선택한 경우에는 동의 없이도 가입할 수 있어요.</p>`;
  const back = draft.step
    ? `<button class="wizard-back" onclick="signupBack()">이전</button>`
    : `<button class="wizard-back" onclick="authForm('login')">로그인으로</button>`;
  const next =
    draft.step === steps.length - 1
      ? `<button class="auth-submit" onclick="completeSignup()">회원가입하고 시작하기</button>`
      : `<button class="auth-submit" onclick="signupNext()">다음</button>`;
  document.querySelector("#auth-form").innerHTML =
    `<section class="signup-wizard">${progress}<div class="wizard-content">${content}</div><div class="wizard-actions">${back}${next}</div></section>`;
  if (draft.step === 0) {
    checkPasswordRequirements();
    if (draft.phone) checkSignupPhone();
  }
}
function setSignupLevel(value) {
  signupDraft.ai = value;
  renderSignupWizard();
}
function previewSignupSensitivity(value, input) {
  signupDraft.sensitivity = Number(value);
  signupDraft.ai = interventionFromSensitivity(signupDraft.sensitivity);
  const label = document.querySelector("#signup-sensitivity-label");
  if (label)
    label.textContent = `${sensitivityLabel(Number(value))} · ${value}`;
  (
    input || document.querySelector(".signup-sensitivity input")
  ).style.setProperty("--sensitivity", `${value}%`);
}
function setSignupSensitivity(value) {
  signupDraft.sensitivity = Number(value);
  signupDraft.ai = interventionFromSensitivity(signupDraft.sensitivity);
}
function setFieldStatus(id, message, state = "") {
  const node = document.querySelector(id);
  if (!node) return;
  node.textContent = message;
  node.className = `field-status ${state}`;
}
function checkSignupPhone() {
  const input = document.querySelector("#signup-phone");
  if (!input) return;
  input.value = input.value.replace(/\D/g, "");
  const phone = input.value;
  clearTimeout(signupPhoneTimer);
  if (phone.length < 7)
    return setFieldStatus(
      "#signup-phone-status",
      "전화번호를 입력하면 중복 여부를 바로 확인해요.",
    );
  setFieldStatus("#signup-phone-status", "확인 중…", "checking");
  signupPhoneTimer = setTimeout(async () => {
    try {
      const out = await api(
        `/api/auth/phone-available?phone=${encodeURIComponent(phone)}`,
      );
      if (document.querySelector("#signup-phone")?.value !== phone) return;
      setFieldStatus(
        "#signup-phone-status",
        out.available
          ? "사용 가능한 전화번호예요."
          : "이미 가입된 전화번호예요.",
        out.available ? "ok" : "error",
      );
    } catch {
      setFieldStatus(
        "#signup-phone-status",
        "중복 여부를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
        "error",
      );
    }
  }, 350);
}
function checkPasswordRequirements() {
  const value = document.querySelector("#signup-password")?.value || "";
  const tests = [
    ["#password-length", value.length >= 6],
    ["#password-letter", /[A-Za-z]/.test(value)],
    ["#password-special", /[^A-Za-z0-9]/.test(value)],
  ];
  tests.forEach(([selector, passed]) => {
    const item = document.querySelector(selector);
    if (item) {
      item.classList.toggle("passed", passed);
      item.textContent = `${passed ? "✓" : "○"} ${item.id === "password-length" ? "6자 이상" : item.id === "password-letter" ? "영어 1자 이상" : "특수문자 1자 이상"}`;
    }
  });
  return tests.every(([, passed]) => passed);
}
function setWizardDetail(name, value) {
  signupAiDetails = { ...signupAiDetails, [name]: value };
  renderSignupWizard();
}
async function signupNext() {
  if (signupDraft.step === 0) {
    const name = document.querySelector("#signup-name").value.trim(),
      phone = document.querySelector("#signup-phone").value.replace(/\D/g, ""),
      password = document.querySelector("#signup-password").value;
    if (!name || phone.length < 7 || !checkPasswordRequirements())
      return alert("이름, 전화번호와 비밀번호 조건을 모두 확인해주세요.");
    try {
      const out = await api(
        `/api/auth/phone-available?phone=${encodeURIComponent(phone)}`,
      );
      if (!out.available) {
        setFieldStatus(
          "#signup-phone-status",
          "이미 가입된 전화번호예요.",
          "error",
        );
        return;
      }
    } catch {
      return setFieldStatus(
        "#signup-phone-status",
        "중복 여부를 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
        "error",
      );
    }
    Object.assign(signupDraft, { name, phone, password });
  }
  signupDraft.step += 1;
  renderSignupWizard();
}
function signupBack() {
  if (signupDraft.step) signupDraft.step -= 1;
  renderSignupWizard();
}
async function completeSignup() {
  signupDraft.consent =
    document.querySelector("#signup-consent")?.checked || false;
  if (signupDraft.ai !== "off" && !signupDraft.consent)
    return alert("AI 사용 안내를 확인하고 동의하거나, AI 끄기를 선택해주세요.");
  const sensitivity = {
    overall: signupDraft.sensitivity,
    categories: Object.fromEntries(
      sensitivityKeys.map((key) => [key, signupDraft.sensitivity]),
    ),
    overrides: {},
  };
  saveSensitivity(sensitivity);
  try {
    const auth = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: signupDraft.name,
        phone: signupDraft.phone,
        password: signupDraft.password,
        ai_intervention: signupDraft.ai,
      }),
    });
    const user = auth.user;
    sessionToken = auth.session_token;
    signedIn = user.name;
    signedInId = user.id;
    aiIntervention = user.ai_intervention || "standard";
    sessionStorage.setItem("retone-v2-session", sessionToken);
    sessionStorage.setItem("retone-v2-name", user.name);
    sessionStorage.setItem("retone-v2-user-id", user.id);
    sessionStorage.setItem("retone-v2-ai-level", aiIntervention);
    sessionStorage.setItem(
      "retone-v2-ai-consent",
      signupDraft.consent || aiIntervention === "off" ? "yes" : "",
    );
    signupDraft = null;
    home();
  } catch {
    alert("이미 가입된 전화번호이거나 입력값을 확인해주세요.");
  }
}
async function finishAdminLogin() {
  const password = document.querySelector("#admin-password").value;
  const two_factor = document.querySelector("#admin-two-factor").value;
  if (!password || !two_factor)
    return alert("비밀번호와 2차 인증 코드를 모두 입력해주세요.");
  try {
    const user = await api("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ password, two_factor }),
    });
    signedIn = user.name;
    signedInId = user.id;
    aiIntervention = "off";
    isAdmin = true;
    sessionStorage.setItem("retone-v2-name", user.name);
    sessionStorage.setItem("retone-v2-user-id", user.id);
    sessionStorage.setItem("retone-v2-ai-level", "off");
    sessionStorage.setItem("retone-v2-admin", "yes");
    settings();
  } catch {
    alert("관리자 비밀번호 또는 2차 인증 코드가 맞지 않아요.");
  }
}
function setSignupAiDetail(button, name, value) {
  signupAiDetails = { ...(signupAiDetails || aiDetails()), [name]: value };
  button
    .closest(".signup-ai-category")
    .querySelectorAll("button")
    .forEach((item) => item.classList.toggle("selected", item === button));
}
async function finishAuth(mode) {
  const name = document.querySelector("#auth-name").value.trim(),
    phone = document.querySelector("#auth-phone").value.replace(/\D/g, ""),
    password = document.querySelector("#auth-password").value,
    ai = document.querySelector("#auth-ai-level")?.value,
    consent = document.querySelector("#auth-ai-consent")?.checked;
  if (!name || !phone || password.length < 6)
    return alert("이름, 전화번호와 6자 이상 비밀번호를 입력해 주세요.");
  if (mode === "signup" && ai !== "off" && !consent)
    return alert(
      "AI 사용 안내를 확인하고 동의하거나, AI 끄기를 선택해 주세요.",
    );
  if (mode === "signup") {
    localStorage.setItem(
      "retone-ai-detail",
      JSON.stringify({ ...aiCategoryDefaults, ...signupAiDetails }),
    );
  }
  try {
    const auth = await api(
      "/api/auth/" + (mode === "signup" ? "signup" : "login"),
      {
        method: "POST",
        body: JSON.stringify({ name, phone, password, ai_intervention: ai }),
      },
    );
    const user = auth.user;
    sessionToken = auth.session_token;
    signedIn = user.name;
    signedInId = user.id;
    aiIntervention = user.ai_intervention || "standard";
    sessionStorage.setItem("retone-v2-session", sessionToken);
    sessionStorage.setItem("retone-v2-name", user.name);
    sessionStorage.setItem("retone-v2-user-id", user.id);
    sessionStorage.setItem("retone-v2-ai-level", aiIntervention);
    sessionStorage.setItem(
      "retone-v2-ai-consent",
      consent || aiIntervention === "off" ? "yes" : "",
    );
    home();
  } catch {
    alert(
      mode === "signup"
        ? "이미 가입된 전화번호이거나 입력값을 확인해 주세요."
        : "이름, 전화번호 또는 비밀번호를 다시 확인해 주세요.",
    );
  }
}
start();
