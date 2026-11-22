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
let replyingTo = null;
let pendingRoomInvitees = [];
let messagePressTimer = null;
let messageSwipe = null;
let suppressMessageTapUntil = 0;
let rewrittenDraftBypass = "";
let pendingAnalysisDraft = "";
let currentRoomMessages = [];
let signupAiDetails = null;
let signupDraft = null;
let signupPhoneTimer = null;
let selectedIntent = "";
let aiPrefetch = { text: "", result: null, promise: null, timer: null };
let roomPollTimer = null;
let inboxPollTimer = null;
let inboxPollInFlight = false;
let roomLoadVersion = 0;
function rememberAvatar(user) {
  if (user?.avatar_url) localStorage.setItem("retone-avatar", user.avatar_url);
  else localStorage.removeItem("retone-avatar");
}
function avatarContent(name, avatarUrl) {
  return avatarUrl
    ? `<img src="${escAttr(avatarUrl)}" alt="${escAttr(name || "프로필")} 프로필 사진">`
    : esc((name || "?").slice(0, 1));
}
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
    return JSON.parse(localStorage.getItem("retone-citations-v3") || "{}");
  } catch {
    return {};
  }
})();
const factChecksInFlight = new Set();
const contextChecksInFlight = new Set();
const FACT_FINDING_VERSION = 3;
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
  "대화 흐름 참고",
  "대화 복구 문장",
];
const initialCategorySensitivity = {
  "강한 공격 표현": 65,
  "비꼼·압박 표현": 60,
  "출처 확인 제안": 35,
  "표현 바꾸기": 50,
  "입력 중 선검사": 50,
  "감정 도움 AI": 50,
  "확인 결과 재사용": 50,
  "말맞춤 카드": 50,
  "대화 흐름 요약": 45,
  "이미지 안전 안내": 50,
  "대화 흐름 참고": 35,
  "대화 복구 문장": 35,
};
function defaultSensitivityCategories() {
  return Object.fromEntries(
    sensitivityKeys.map((key) => [key, initialCategorySensitivity[key] ?? 50]),
  );
}
function sensitivityState() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("retone-ai-sensitivity") || "{}",
    );
    // v3 restores the intended baseline for attack and indirect-pressure checks.
    // Explicitly disabled (0) categories stay disabled.
    const strengthenBaseline = Number(saved.categoryVersion || 0) < 3;
    const savedOverall = Number.isFinite(saved.overall) ? saved.overall : 55;
    return {
      overall:
        strengthenBaseline && savedOverall > 0
          ? Math.max(55, savedOverall)
          : savedOverall,
      categories: Object.fromEntries(
        sensitivityKeys.map((key) => {
          const savedValue = Number.isFinite(saved.categories?.[key])
            ? saved.categories[key]
            : initialCategorySensitivity[key];
          const baseline = initialCategorySensitivity[key] ?? 50;
          const shouldStrengthen =
            strengthenBaseline &&
            savedValue > 0 &&
            ["강한 공격 표현", "비꼼·압박 표현"].includes(key);
          return [key, shouldStrengthen ? Math.max(savedValue, baseline) : savedValue];
        }),
      ),
      overrides: saved.overrides || {},
      learning: saved.learning || {},
    };
  } catch {
    return {
      overall: 55,
      categories: defaultSensitivityCategories(),
      overrides: {},
      learning: {},
    };
  }
}
function saveSensitivity(state) {
  localStorage.setItem(
    "retone-ai-sensitivity",
    JSON.stringify({ ...state, categoryVersion: 3 }),
  );
}
function learnFromSendAnyway(category) {
  const state = sensitivityState();
  const learning = state.learning[category] || { bypasses: 0, adjustments: 0 };
  learning.bypasses += 1;
  if (learning.bypasses % 3 === 0 && state.categories[category] > 15) {
    state.categories[category] = Math.max(15, state.categories[category] - 5);
    learning.adjustments += 1;
  }
  state.learning[category] = learning;
  saveSensitivity(state);
}
function learningNote() {
  const entries = Object.entries(sensitivityState().learning || {}).filter(([, value]) => value.bypasses);
  if (!entries.length) return "‘그냥 보내기’ 선택이 쌓이면 같은 종류의 경고를 조금 덜 보여줘요.";
  const [name, value] = entries.sort((a, b) => b[1].bypasses - a[1].bypasses)[0];
  return `최근 ‘${name}’ 경고를 ${value.bypasses}번 그냥 보냈어요. 이 선택은 이 기기에서만 민감도 조절에 반영돼요.`;
}
function sensitivityWord(name, value) {
  if (value <= 0) return "끄기";
  if (["입력 중 선검사", "확인 결과 재사용"].includes(name)) return "켜기";
  if (
    ["이미지 안전 안내", "대화 흐름 참고", "대화 복구 문장"].includes(name)
  )
    return value >= 70 ? "민감하게" : "필요할 때";
  if (["표현 바꾸기", "감정 도움 AI"].includes(name))
    return value >= 75 ? "항상" : "필요할 때";
  if (name === "말맞춤 카드") return value >= 75 ? "넓게" : "약속 대화만";
  if (name === "대화 흐름 요약") return "눌렀을 때만";
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
  if (mode !== "inherit") return mode;
  const localLevel = interventionFromSensitivity(sensitivityState().overall);
  if (aiIntervention === "off" || localLevel === "off") return "off";
  const rank = { light: 1, standard: 2, careful: 3 };
  return (rank[localLevel] || 2) > (rank[aiIntervention] || 2)
    ? localLevel
    : aiIntervention;
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
    flow: ["말맞춤 카드", "대화 흐름 요약", "대화 흐름 참고", "대화 복구 문장"],
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
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const AI_CACHE_VERSION = "pre-context-v1";
const aiContextSnapshot = () => currentRoomMessages
  .slice(-12)
  .map((message) => `${message.sender}: ${String(message.body || "").slice(0, 300)}`);
const aiCacheKey = (text) =>
  `${AI_CACHE_VERSION}|${signedInId}|${activeAiIntervention()}|${JSON.stringify(aiDetails())}|${aiContextSnapshot().join("\n")}|${text.trim()}`;
function savedAiResult(text) {
  const result = aiSavedResults[aiCacheKey(text)] || null;
  return result && (result.verdict === "PASS" || result.verdict === "WARN")
    ? result
    : null;
}
function rememberAiResult(text, result) {
  if (["fallback","unavailable"].includes(result?.source)) return;
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
  if (signedInId && !isAdmin && !url.startsWith("/api/auth/")) headers["X-ReTone-User"] = signedInId;
  const r = await fetch(url, {
    ...options,
    headers,
  });
  if (!r.ok) {
    const error = new Error(`Request failed: ${r.status}`);
    error.status = r.status;
    throw error;
  }
  if (r.status === 204) return {};
  return r.json();
}
function rail() {
  return `<aside class="rail"><div class="brand">Re:<i>Tone</i></div><p>더 나은 대화를 위한<br>새로운 작업 공간</p><nav><button class="${nav === "chat" ? "active" : ""}" onclick="home()">채팅</button><button class="${nav === "friends" ? "active" : ""}" onclick="friends()">친구</button><button class="${nav === "settings" ? "active" : ""}" onclick="settings()">설정</button></nav><small>${esc(signedIn || "Re:Tone")} · v2</small></aside>`;
}
function connectionIssue(title, retry) {
  return `<main class="layout">${rail()}<section class="page"><header class="head"><h1>${esc(title)}</h1></header><div class="content"><section class="empty-chat connection-issue"><b>연결을 확인하지 못했어요</b><span>인터넷 또는 서버 상태를 확인한 뒤 다시 시도해주세요.</span><button onclick="${retry}">다시 시도</button></section></div></section></main>`;
}
async function home() {
  nav = "chat";
  roomLoadVersion += 1;
  stopRoomPolling();
  roomId = null;
  try {
    data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
  } catch {
    app.innerHTML = connectionIssue("채팅", "home()");
    return;
  }
  const rooms = data.rooms.filter(
    (r) =>
      !["science", "friends"].includes(r.id) &&
      !hasLeftRoom(r.id) &&
      (r.is_group || r.has_messages),
  ).sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
  const now = localDateTimeValue(new Date()).replace("T", " ");
  const upcoming = (data.appointments || [])
    .filter((appointment) => appointment.date >= now)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>채팅</h1><button class="new-room" onclick="newRoom()">＋ 새 대화</button></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님, 반가워요.</h2><p>친구를 초대해 첫 대화를 시작해 보세요.</p></div><div class="dash"><section class="focus"><b>오늘의 공동 확인</b><span>채팅방에서 함께 확인할 일을 만들어 보세요.</span></section><section class="focus schedule"><b>다음 약속 <button onclick="newAppointment()">＋</button></b><span>${upcoming ? `${esc(upcoming.title)} · ${esc(upcoming.date)}` : "친구들과 약속을 정하면 여기에 보여요."}</span></section></div><div class="rooms">${rooms.length ? rooms.map((r) => `<button class="room" data-room-id="${esc(r.id)}" onclick="openRoom('${r.id}')"><span class="avatar">${avatarContent(r.name, r.avatar_url)}</span><span class="copy"><b>${r.pinned ? "📌 " : ""}${esc(r.name)}</b><span class="room-last">${esc(r.last)}</span></span>${r.unread ? `<span class="badge">${r.unread}</span>` : ""}</button>`).join("") : `<button class="empty-chat" onclick="newRoom()"><b>아직 대화가 없어요</b><span>친구를 초대하거나 단체 채팅을 만들어 보세요. ＋</span></button>`}</div></div></section></main>`;
  startInboxPolling(data);
}
async function openRoom(id) {
  stopInboxPolling();
  if (roomId === id && document.querySelector("#messages")?.dataset.room === id) {
    syncRoomExtras(id,currentRoomMessages);
    return refreshRoom(id).catch(()=>{});
  }
  const loadVersion = ++roomLoadVersion;
  const refreshingCurrentRoom = roomId === id;
  const previousInput = refreshingCurrentRoom ? document.querySelector("#text") : null;
  const draft = previousInput?.value || "";
  const inputWasFocused = document.activeElement === previousInput;
  const cursor = previousInput?.selectionStart ?? draft.length;
  const previousList = refreshingCurrentRoom ? document.querySelector("#messages") : null;
  const previousScrollTop = previousList?.scrollTop || 0;
  const wasNearBottom = previousList
    ? previousList.scrollHeight - previousList.scrollTop - previousList.clientHeight < 96
    : true;
  stopRoomPolling();
  roomId = id;
  const room = data.rooms.find((r) => r.id === id);
  if (!room) {
    roomId = null;
    alert("이 채팅방을 더 이상 찾을 수 없어요. 채팅 목록을 새로 불러올게요.");
    return home();
  }
  let messages;
  try {
    messages = await api(
      `/api/rooms/${id}/messages?user_id=${encodeURIComponent(signedInId)}`,
    );
  } catch {
    if (roomId === id && loadVersion === roomLoadVersion) {
      stopRoomPolling();
      app.innerHTML = connectionIssue("채팅방", `openRoom('${id}')`);
    }
    return;
  }
  if (roomId !== id || loadVersion !== roomLoadVersion) return;
  currentRoomMessages = messages;
  if (replyingTo?.room_id !== id) replyingTo = null;
  else if (replyingTo) replyingTo = messages.find((message) => message.id === replyingTo.id) || null;
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
  app.innerHTML = `<main class="layout">${rail()}<section class="chat"><header class="head"><button class="back-button" title="채팅 목록으로" aria-label="채팅 목록으로" onclick="home()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7M8 12h9"/></svg></button><span class="room-head-avatar avatar">${avatarContent(room.name, room.avatar_url)}</span><div class="room-title"><h1>${esc(room.name)}</h1>${room.members >= 3 ? `<span class="room-participants">참여자 ${room.members}명</span>` : ""}<span class="room-slot" id="pulse-slot">${conversationPulse()}</span></div><div class="chat-actions"><button class="chat-primary-action" title="친구 초대" aria-label="친구 초대" onclick="inviteFriends()">＋</button><button class="chat-primary-action" title="AI 도움받기" aria-label="AI 도움받기" onclick="openAiHelp()">✦</button><button class="chat-secondary-action" title="약속 잡기" aria-label="약속 잡기" onclick="newAppointment()">◷</button><button class="chat-secondary-action" title="공동 확인" aria-label="공동 확인" onclick="newAgreement()">✓</button><button class="chat-secondary-action" title="회고 카드" aria-label="회고 카드" onclick="newReflection()">↻</button><button class="chat-secondary-action" title="채팅방 설정" aria-label="채팅방 설정" onclick="roomSettings()">⚙</button><button class="chat-more-action" title="더 보기" aria-label="더 보기" onclick="openChatMore()">⋯</button></div></header><section class="messages" id="messages" data-room="${escAttr(id)}">${messages.map(view).join("")}<template id="message-end"></template><div id="typing-status" class="typing-bubble" role="status" aria-live="polite"></div><div class="room-slot" id="alignment-slot">${alignmentCard(messages)}</div><div class="room-slot" id="appointments-slot">${appointments.map(viewAppointment).join("")}</div><div class="room-slot" id="reflections-slot">${reflections.map(viewReflection).join("")}</div><div class="room-slot" id="agreements-slot">${agreementMarkup(id)}</div></section><form class="sendbar" onsubmit="send(event)"><span id="reply-slot" class="room-slot">${replyComposer()}</span><button type="button" class="intent-button" title="의도 표시" onclick="chooseIntent()">${selectedIntent ? "◎" : "＋"}</button><label class="image-upload" title="사진 보내기" aria-label="사진 보내기"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="m5.5 17 4.5-4 3.2 2.7 2.4-2 2.9 3.3"/></svg><input hidden type="file" accept="image/*" onchange="sendImage(this)"></label><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="onChatTyping(this.value)" onblur="stopTyping()"><span id="ai-status" class="ai-status"></span><button>↑</button></form></section></main>`;
  document.querySelector(".chat > .head")?.insertAdjacentHTML(
    "afterend",
    `<div class="appointment-notice-slot" id="appointment-notice-slot">${appointmentNotice(appointments)}</div>`,
  );
  const quickAiButton = document.querySelector(".intent-button");
  if (quickAiButton) {
    quickAiButton.textContent = "✦";
    quickAiButton.title = "AI 기본 설정";
    quickAiButton.setAttribute("aria-label", "AI 기본 설정");
  }
  const list = document.querySelector("#messages");
  if (refreshingCurrentRoom && !wasNearBottom) list.scrollTop = previousScrollTop;
  else list.scrollTop = list.scrollHeight;
  const input = document.querySelector("#text");
  input.value = draft;
  if (inputWasFocused || draft) {
    input.focus();
    input.setSelectionRange(cursor, cursor);
  }
  startRoomPolling(id);
  queueFactChecks(messages);
}
function stopRoomPolling() {
  ++syncSequence;
  stopTyping();
  if (roomPollTimer) {
    clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
}
function stopInboxPolling() {
  if (inboxPollTimer) {
    clearInterval(inboxPollTimer);
    inboxPollTimer = null;
  }
  inboxPollInFlight = false;
}
function updateHomeRoomSummaries(rooms) {
  rooms
    .slice()
    .sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0))
    .forEach((room) => {
    const button = document.querySelector(`[data-room-id="${room.id}"]`);
    if (!button) return;
    const last = button.querySelector(".room-last");
    if (last) last.textContent = room.last || "";
    const badge = button.querySelector(".badge");
    if (room.unread) {
      if (badge) badge.textContent = room.unread;
      else button.insertAdjacentHTML("beforeend", `<span class="badge">${room.unread}</span>`);
    } else {
      badge?.remove();
    }
    button.parentElement?.appendChild(button);
  });
}
function notifyUnreadRoom(room, previousUnread) {
  if (
    !browserNotificationsEnabled() ||
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    isRoomMuted(room.id)
  )
    return;
  const added = Math.max(1, room.unread - previousUnread);
  new Notification(room.name || "Re:Tone", {
    body: added === 1 ? "새 메시지가 왔어요." : `새 메시지 ${added}개가 왔어요.`,
    tag: `retone-${room.id}`,
  });
}
function startInboxPolling(initialData = data) {
  stopInboxPolling();
  let knownUnread = new Map(
    (initialData?.rooms || []).map((room) => [room.id, Number(room.unread || 0)]),
  );
  inboxPollTimer = setInterval(async () => {
    if (roomId || isAdmin || !signedInId || inboxPollInFlight) return;
    const viewVersion = roomLoadVersion;
    inboxPollInFlight = true;
    try {
      const latest = await api(
        `/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`,
      );
      if (roomId || viewVersion !== roomLoadVersion) return;
      latest.rooms.forEach((room) => {
        const previous = knownUnread.get(room.id) || 0;
        if (Number(room.unread || 0) > previous) notifyUnreadRoom(room, previous);
      });
      knownUnread = new Map(
        latest.rooms.map((room) => [room.id, Number(room.unread || 0)]),
      );
      data = latest;
      updateHomeRoomSummaries(latest.rooms);
    } catch {
      // 백그라운드 새로고침 실패는 현재 화면을 바꾸지 않습니다.
    } finally {
      inboxPollInFlight = false;
    }
  }, 5000);
}
function updateReadReceipts(messages) {
  const unreadByMessage = new Map(
    messages
      .filter((message) => message.mine)
      .map((message) => [message.id, Number(message.unread || 0)]),
  );
  document.querySelectorAll(".bubble.mine[data-message-id]").forEach((bubble) => {
    const messageId = bubble.dataset.messageId;
    const unread = unreadByMessage.get(messageId) || 0;
    const receipt = bubble.querySelector(".read");
    if (!unread) {
      receipt?.remove();
      return;
    }
    if (receipt) {
      receipt.textContent = unread;
      return;
    }
    (bubble.querySelector(".bubble-tools") || bubble).insertAdjacentHTML("beforeend", `<span class="read">${unread}</span>`);
  });
}
let syncSequence = 0;
let typingLease = null;
let typingWrites = Promise.resolve();

function signalTyping(room, active) {
  // Serialize writes so a slow "started" cannot arrive after "stopped".
  const account = signedInId;
  typingWrites = typingWrites.then(() => {
    if (signedInId !== account || (active && typingLease?.room !== room)) return;
    return api(`/api/rooms/${room}/typing`, {method: "POST", body: JSON.stringify({active})});
  }).catch(() => {});
}
function stopTyping() {
  if (!typingLease) return;
  const {room, idle} = typingLease;
  clearTimeout(idle);
  typingLease = null;
  signalTyping(room, false);
}
function onChatTyping(value) {
  queueAiCheck(value);
  if (!value.trim() || !roomId) return stopTyping();
  if (typingLease?.room !== roomId) {
    stopTyping();
    typingLease = {room:roomId, last:0};
  }
  if (Date.now() - typingLease.last > 2000) {
    typingLease.last = Date.now();
    signalTyping(roomId,true);
  }
  clearTimeout(typingLease.idle);
  typingLease.idle = setTimeout(stopTyping, 3000);
}
function updateFragment(selector, markup) {
  const target = document.querySelector(selector);
  if (target && target._markup !== markup) {
    target.innerHTML = markup;
    target._markup = markup;
  }
}
function agreementMarkup(id) {
  return data.agreements
    .filter((agreement) => agreement.room_id === id)
    .slice(0, 1)
    .map(
      (a) =>
        `<article class="agreement"><b>✓ 공동 확인 · ${esc(a.task)}</b><small>담당 ${esc(a.assignee)} · ${esc(a.deadline)} · 확인 ${a.confirmations} · 보완 ${a.revisions}</small><div><button onclick="answerAgreement('${a.id}','confirm')">확인했어요</button><button class="quiet" onclick="answerAgreement('${a.id}','revise')">보완 요청</button></div></article>`,
    )
    .join(
      "",
    );
}
function syncRoomExtras(id, messages) {
  updateFragment("#agreements-slot",agreementMarkup(id));
  updateFragment("#reflections-slot",(data.reflections || []).filter(a=>a.room_id===id).map(viewReflection).join(""));
  const room = data.rooms.find(r=>r.id===id);
  if (room) {
    const header = document.querySelector(".room-participants");
    if (header && room.members >= 3) header.textContent = `참여자 ${room.members}명`;
  }
  updateFragment("#alignment-slot", alignmentCard(messages));
  updateFragment("#appointment-notice-slot", appointmentNotice((data.appointments || []).filter(a=>a.room_id===id)));
  updateFragment("#appointments-slot", "");
  updateFragment("#pulse-slot", conversationPulse());
  updateFragment("#reply-slot", replyComposer());
}
function reconcileBubbles(list, latest) {
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const previous = new Map(currentRoomMessages.map(m=>[m.id,m]));
  currentRoomMessages = latest;
  const ids = new Set(latest.map(m=>m.id));
  const nodes = new Map();
  for (const node of list.querySelectorAll(".bubble[data-message-id]")) {
    if (ids.has(node.dataset.messageId)) nodes.set(node.dataset.messageId,node);
    else node.remove();
  }
  let next = list.querySelector("#message-end");
  for (let i=latest.length-1;i>=0;i--) {
    const m = latest[i];
    let node = nodes.get(m.id);
    if (!node) {
      next.insertAdjacentHTML("beforebegin", view(m));
      node = next.previousElementSibling;
      if (!m.mine && !previous.has(m.id)) notifyNewMessage(m);
    } else if (m.reply_to && previous.has(m.reply_to) && !ids.has(m.reply_to)) {
      node.outerHTML = view(m);
      node = next.previousElementSibling;
    }
    next = node;
  }
  if (replyingTo && !ids.has(replyingTo.id)) replyingTo=null;
  updateReadReceipts(latest);
  syncRoomExtras(roomId, latest);
  if (nearBottom) list.scrollTop = list.scrollHeight;
  if (latest.some(m=>!previous.has(m.id))) queueFactChecks(latest);
}
async function refreshRoom(id) {
  const list = document.querySelector("#messages");
  if (roomId !== id || list?.dataset.room !== id) return;
  const request = ++syncSequence;
  const result = await api(`/api/rooms/${id}/sync`);
  if (request !== syncSequence || roomId !== id || !list.isConnected) return;
  for (const key of ["appointments", "agreements", "reflections", "insights"]) {
    data[key] = (data[key] || []).filter(item=>item.room_id!==id).concat(result[key]);
  }
  const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
  reconcileBubbles(list,result.messages);
  const label = document.querySelector("#typing-status");
  const names = result.typing || [];
  const typingKey = names.join("|");
  if (label && label.dataset.typing !== typingKey) {
    label.dataset.typing = typingKey;
    if (!names.length) {
      label.replaceChildren();
      label.removeAttribute("aria-label");
    } else {
      const description = names.length === 1
        ? `${names[0]}님이 입력 중`
        : `${names[0]}님 외 ${names.length - 1}명이 입력 중`;
      label.setAttribute("aria-label", description);
      label.innerHTML = `<span class="typing-avatar">${esc(names[0].slice(0, 1))}</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><small>${esc(description)}</small>`;
    }
  }
  if (wasNearBottom && names.length) list.scrollTop = list.scrollHeight;
}
function startRoomPolling(id) {
  let busy = false;
  roomPollTimer = setInterval(async () => {
    if (roomId !== id || busy || document.hidden) return;
    busy = true;
    try { await refreshRoom(id); } catch {} finally { busy = false; }
  }, 1800);
}
async function toggleBrowserNotifications() {
  if (!("Notification" in window)) return alert("이 브라우저에서는 알림을 지원하지 않아요.");
  const permission = await Notification.requestPermission();
  localStorage.setItem("retone-browser-notifications", permission === "granted" ? "1" : "0");
  settings();
}
function notifyNewMessage(message) {
  if (!browserNotificationsEnabled() || !("Notification" in window) || Notification.permission !== "granted" || isRoomMuted(roomId)) return;
  const room = data?.rooms?.find((item) => item.id === roomId);
  new Notification(room?.name || "Re:Tone", { body: `${message.sender}: ${message.body || "사진을 보냈어요."}`, tag: `retone-${roomId}` });
}
async function friends() {
  nav = "friends";
  roomLoadVersion += 1;
  stopRoomPolling();
  roomId = null;
  let relations;
  try {
    relations = await api(`/api/friends?user_id=${encodeURIComponent(signedInId)}`);
  } catch {
    app.innerHTML = connectionIssue("친구", "friends()");
    return;
  }
  const person = (user, action, detail) => `<article class="friend-row"><span class="avatar">${user.avatar_url ? `<img src="${user.avatar_url}" alt="">` : esc(user.name[0])}</span><span class="copy"><b>${esc(user.name)}</b><span>${detail}</span></span>${action}</article>`;
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><div class="friend-head-actions"><button class="new-room" onclick="openFriendAdd()">＋ 친구 추가</button><button class="head-quiet" onclick="home()">채팅 목록</button></div></header><div class="content"><div class="intro friend-intro"><div><h2>내 친구</h2><p>정확한 이름, 전화번호, 친구코드 또는 QR로 친구 요청을 보낼 수 있어요. 가입한 전체 사용자는 표시하지 않아요.</p></div><button id="my-code-entry" class="my-code-entry" onclick="openFriendAdd('qr')"><span>내 친구코드</span><b>불러오는 중</b><i>QR 보기</i></button></div>${relations.incoming.length ? `<section class="friend-section"><b>받은 친구 요청 <em>${relations.incoming.length}</em></b><div>${relations.incoming.map((user) => person(user, `<button onclick="acceptFriend('${user.id}')">수락</button><button class="soft" onclick="blockFriend('${user.id}')">차단</button>`, "친구 요청을 보냈어요")).join("")}</div></section>` : ""}<section class="friend-section"><b>친구 ${relations.friends.length}</b><div>${relations.friends.length ? relations.friends.map((user) => person(user, `<button onclick="startDirect('${esc(user.name)}','${user.id}')">채팅</button><button class="soft" onclick="blockFriend('${user.id}')">차단</button>`, "1:1 대화를 시작할 수 있어요")).join("") : `<div class="empty-chat"><b>아직 친구가 없어요</b><span>위의 ‘친구 추가’에서 이름, 전화번호, 코드 또는 QR로 요청을 보내보세요.</span></div>`}</div></section>${relations.outgoing.length ? `<section class="friend-section"><b>보낸 요청</b><div>${relations.outgoing.map((user) => person(user, `<span class="request-state">대기 중</span>`, "수락을 기다리고 있어요")).join("")}</div></section>` : ""}${relations.blocked.length ? `<details class="blocked-list"><summary>차단한 사용자 ${relations.blocked.length}명</summary><p>차단한 사용자는 친구 요청과 채팅을 시작할 수 없어요.</p></details>` : ""}</div></section></main>`;
  loadFriendCodeEntry();
  startInboxPolling(data);
}
let friendIdentityCache = null;
async function getFriendIdentity() {
  if (friendIdentityCache?.userId === signedInId) return friendIdentityCache.profile;
  const profile = await api("/api/friends/me");
  friendIdentityCache = {userId:signedInId, profile};
  return profile;
}
async function loadFriendCodeEntry() {
  const entry = document.querySelector("#my-code-entry");
  if (!entry) return;
  try {
    const profile = await getFriendIdentity();
    if (!document.contains(entry)) return;
    entry.dataset.friendCode = profile.friend_code;
    entry.querySelector("b").textContent = profile.friend_code;
  } catch {
    if (document.contains(entry)) entry.innerHTML = `<span>내 친구코드</span><b>다시 확인</b><i>눌러서 열기</i>`;
  }
}
function openFriendAdd(initialMode = "name") {
  popup(`<div class="friend-add-card"><span>친구 추가</span><h2>친구를 찾아볼까요?</h2><p>상대가 요청을 수락하면 1:1 대화를 시작할 수 있어요.</p><button class="friend-code-overview" id="friend-code-overview" onclick="showFriendAddPanel('qr')"><span>내 친구코드</span><b>불러오는 중…</b><i>QR · 복사</i></button><div class="friend-add-tabs"><button data-friend-add="name" onclick="showFriendAddPanel('name')">이름</button><button data-friend-add="phone" onclick="showFriendAddPanel('phone')">전화번호</button><button data-friend-add="code" onclick="showFriendAddPanel('code')">친구코드</button><button data-friend-add="qr" onclick="showFriendAddPanel('qr')">내 QR</button></div><div id="friend-add-panel"></div></div>`);
  hydrateFriendCodeOverview();
  showFriendAddPanel(initialMode);
}
async function hydrateFriendCodeOverview() {
  const entry = document.querySelector("#friend-code-overview");
  if (!entry) return;
  try {
    const profile = await getFriendIdentity();
    if (!document.contains(entry)) return;
    entry.dataset.friendCode = profile.friend_code;
    entry.querySelector("b").textContent = profile.friend_code;
  } catch {
    if (document.contains(entry)) entry.querySelector("b").textContent = "불러오지 못했어요";
  }
}
function showFriendAddPanel(mode) {
  document.querySelectorAll("[data-friend-add]").forEach((button) => button.classList.toggle("selected", button.dataset.friendAdd === mode));
  const panel = document.querySelector("#friend-add-panel");
  if (!panel) return;
  if (mode === "name") {
    panel.innerHTML = `<label>친구 이름<input id="friend-name" autocomplete="off" maxlength="30" placeholder="가입할 때 입력한 이름"></label><small>개인정보 보호를 위해 이름이 정확히 일치할 때만 찾아요. 동명이인이 있으면 친구코드를 이용해주세요.</small><button onclick="lookupFriend('name')">친구 찾기</button><div id="friend-search-result"></div>`;
    return;
  }
  if (mode === "phone") {
    panel.innerHTML = `<label>친구 전화번호<input id="friend-phone" inputmode="numeric" autocomplete="tel" maxlength="13" oninput="formatPhoneInput(this)" placeholder="010-1234-5678"></label><small>전화번호는 친구를 찾는 데에만 사용되며, 상대에게 공개되지 않아요.</small><button onclick="lookupFriend('phone')">친구 찾기</button><div id="friend-search-result"></div>`;
    return;
  }
  if (mode === "code") {
    panel.innerHTML = `<label>친구코드<input id="friend-code" autocapitalize="characters" autocomplete="off" maxlength="6" placeholder="예: A7K9Q2"></label><small>친구가 직접 알려준 6자리 코드를 입력해주세요.</small><button onclick="lookupFriend('code')">친구 찾기</button><div id="friend-search-result"></div>`;
    return;
  }
  panel.innerHTML = `<div class="my-qr-card" id="my-friend-qr"><div class="thinking-loader"><i></i><i></i><i></i></div><small>내 QR 코드를 준비하고 있어요.</small></div><div class="qr-actions"><button class="quiet" onclick="copyFriendCode()">코드 복사</button><button onclick="shareFriendCode()">공유하기</button></div><div class="qr-divider"><span>친구의 QR을 받았다면</span></div><label class="qr-scan-button"><span>⌗</span><b>QR 사진 선택</b><small>카메라로 찍었거나 저장한 사진</small><input type="file" accept="image/*" capture="environment" onchange="scanFriendQr(this)"></label>`;
  loadMyFriendQr();
}
async function loadMyFriendQr() {
  const card = document.querySelector("#my-friend-qr");
  if (!card) return;
  try {
    const profile = await getFriendIdentity();
    card.dataset.friendCode = profile.friend_code;
    card.innerHTML = `<div class="qr-title"><span>내 QR 코드</span><small>상대방이 스캔하면 내 친구코드가 입력돼요.</small></div><div class="qr-image">${profile.qr_svg}</div><button class="friend-code-chip" onclick="copyFriendCode()"><span>내 친구코드</span><b>${esc(profile.friend_code)}</b><i>복사</i></button>`;
  } catch {
    card.innerHTML = `<b>QR 코드를 불러오지 못했어요.</b><small>잠시 후 다시 열어주세요.</small>`;
  }
}
function friendCodeFromQr(value) {
  const matched = String(value || "").trim().match(/^RETONE-FRIEND:([A-Z0-9-]+)$/i);
  return matched ? matched[1].toUpperCase() : "";
}
let qrDecoderPromise = null;
function loadQrDecoder() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (qrDecoderPromise) return qrDecoderPromise;
  qrDecoderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
    script.async = true;
    script.onload = () => window.jsQR ? resolve(window.jsQR) : reject(new Error("qr-decoder-missing"));
    script.onerror = () => reject(new Error("qr-decoder-load-failed"));
    document.head.appendChild(script);
  }).catch((error) => {
    qrDecoderPromise = null;
    throw error;
  });
  return qrDecoderPromise;
}
function qrImagePixels(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, width, height);
        resolve(context.getImageData(0, 0, width, height));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("qr-image-invalid"));
    };
    image.src = url;
  });
}
async function decodeFriendQr(file) {
  if (window.BarcodeDetector && window.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await new BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap);
      bitmap.close?.();
      const nativeCode = friendCodeFromQr(codes[0]?.rawValue);
      if (nativeCode) return nativeCode;
    } catch {}
  }
  const [decoder, pixels] = await Promise.all([loadQrDecoder(), qrImagePixels(file)]);
  return friendCodeFromQr(decoder(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" })?.data);
}
async function scanFriendQr(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const panel = document.querySelector("#my-friend-qr");
    if (panel) panel.insertAdjacentHTML("afterend", `<div id="qr-scan-progress" class="friend-lookup-loading"><span class="thinking-loader"><i></i><i></i><i></i></span>QR 사진을 읽고 있어요.</div>`);
    const friendCode = await decodeFriendQr(file);
    if (!friendCode) throw new Error("not-retone-qr");
    document.querySelector("#qr-scan-progress")?.remove();
    showFriendAddPanel("code");
    document.querySelector("#friend-code").value = friendCode;
    lookupFriend("code");
  } catch {
    document.querySelector("#qr-scan-progress")?.remove();
    alert("QR을 읽지 못했어요. 사진을 다시 선택하거나 친구코드 6자리를 입력해주세요.");
  } finally {
    input.value = "";
  }
}
async function copyFriendCode() {
  let code = document.querySelector("#my-friend-qr")?.dataset.friendCode || document.querySelector("#friend-code-overview")?.dataset.friendCode || document.querySelector("#my-code-entry")?.dataset.friendCode;
  if (!code) {
    try { code = (await getFriendIdentity()).friend_code; } catch { return alert("친구코드를 불러오지 못했어요. 잠시 후 다시 시도해주세요."); }
  }
  try {
    await navigator.clipboard.writeText(code);
    alert("친구코드를 복사했어요.");
  } catch {
    alert(`친구코드: ${code}`);
  }
}
async function shareFriendCode() {
  let code = document.querySelector("#my-friend-qr")?.dataset.friendCode || document.querySelector("#friend-code-overview")?.dataset.friendCode;
  if (!code) {
    try { code = (await getFriendIdentity()).friend_code; } catch { return alert("친구코드를 불러오지 못했어요. 잠시 후 다시 시도해주세요."); }
  }
  const text = `Re:Tone 친구코드: ${code}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Re:Tone 친구 추가", text }); return; } catch {}
  }
  try { await navigator.clipboard.writeText(text); alert("친구코드를 복사했어요."); } catch { alert(text); }
}
async function lookupFriend(mode) {
  const field = document.querySelector(mode === "name" ? "#friend-name" : mode === "phone" ? "#friend-phone" : "#friend-code");
  const value = field?.value.trim();
  if (!value) return alert(mode === "name" ? "친구의 정확한 이름을 입력해주세요." : mode === "phone" ? "전화번호를 입력해주세요." : "친구코드를 입력해주세요.");
  if (mode === "phone" && !isValidMobilePhone(value))
    return alert("010-1234-5678 형식의 휴대폰 번호를 입력해주세요.");
  const root = document.querySelector("#friend-search-result");
  if (root) root.innerHTML = `<div class="friend-lookup-loading"><span class="thinking-loader"><i></i><i></i><i></i></span>친구를 찾고 있어요.</div>`;
  try {
    const payload = mode === "name" ? { name: value } : mode === "phone" ? { phone: phoneDigits(value) } : { friend_code: value };
    const result = await api("/api/friends/lookup", { method: "POST", body: JSON.stringify(payload) });
    if (!root) return;
    if (!result.user) {
      root.innerHTML = `<div class="friend-search-empty">${result.ambiguous ? "같은 이름의 사용자가 둘 이상이에요. 친구코드나 전화번호로 찾아주세요." : mode === "name" ? "정확히 일치하는 이름의 사용자가 없어요." : "찾는 사용자가 없어요. 입력 정보를 다시 확인해주세요."}</div>`;
      return;
    }
    const user = result.user;
    const state = {friend:"이미 친구예요",outgoing:"이미 요청을 보냈어요",incoming:"나에게 요청을 보낸 사용자예요",blocked:"차단된 사용자예요"}[result.relationship];
    root.innerHTML = `<article class="friend-search-result"><span class="avatar">${user.avatar_url ? `<img src="${user.avatar_url}" alt="">` : esc(user.name[0])}</span><span><b>${esc(user.name)}</b><small>${state || "이 사용자에게 친구 요청을 보낼까요?"}</small></span>${result.relationship === "none" ? `<button onclick="requestFriend('${user.id}',true)">요청 보내기</button>` : `<i class="friend-result-state">${state}</i>`}</article>`;
  } catch (error) {
    if (root) root.innerHTML = `<div class="friend-search-empty">친구를 찾지 못했어요. 입력한 정보를 다시 확인해주세요.</div>`;
  }
}
async function requestFriend(id, closeAfter = false) {
  try {
    await api("/api/friends/request", { method: "POST", body: JSON.stringify({ user_id: signedInId, target_id: id }) });
    if (closeAfter) closePopup();
    friends();
  } catch (error) {
    alert(error.status === 409 ? "이미 친구이거나 처리 중인 친구 요청이 있어요." : "친구 요청을 보내지 못했어요. 연결 상태를 확인한 뒤 다시 시도해주세요.");
  }
}
async function acceptFriend(id) {
  try {
    await api("/api/friends/accept", { method: "POST", body: JSON.stringify({ user_id: signedInId, target_id: id }) });
    friends();
  } catch {
    alert("친구 요청을 수락하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
async function blockFriend(id) {
  if (!confirm("이 사용자를 차단할까요? 친구 요청과 새 채팅을 할 수 없게 됩니다.")) return;
  try {
    await api("/api/blocks", { method: "POST", body: JSON.stringify({ user_id: signedInId, target_id: id }) });
    friends();
  } catch {
    alert("차단 처리하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
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
  try {
    const room = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        name,
        creator_id: signedInId,
        invitee_ids: inviteeId ? [inviteeId] : [],
        direct: true,
      }),
    });
    data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
    openRoom(room.id);
  } catch {
    alert("1:1 채팅을 시작하지 못했어요. 친구 상태와 연결을 확인해주세요.");
  }
}
function settings() {
  roomLoadVersion += 1;
  stopRoomPolling();
  roomId = null;
  nav = "settings";
  if (isAdmin) {
    app.innerHTML = `<main class="admin-layout"><header class="admin-top"><div class="admin-wordmark">Re:<i>Tone</i><span>관리자</span></div><button class="admin-logout" onclick="logout()">로그아웃</button></header><section class="admin-page"><header class="admin-page-head"><span>서비스 운영</span><h1>Re:Tone 관리자</h1><p>사용자별 계정 관리와 AI 문의를 한 곳에서 확인해요.</p></header><div class="admin-grid"><section class="admin-panel"><b>관리자 로그인 완료</b><span>일반 사용자 대화에는 관리자 권한이 자동으로 개입하지 않아요.</span><button onclick="openAdminReports()">AI 문의 확인</button></section><section class="admin-users"><div><b>가입 사용자</b><span>초기화할 계정을 개별로 선택하세요.</span></div><div id="admin-users-list" class="admin-users-list"><small>사용자 목록을 불러오는 중…</small></div></section><section class="admin-danger"><b>전체 서비스 데이터 초기화</b><p>모든 계정, 친구 관계, 채팅, 사진, 일정, 반응, AI 문의와 확인 기록을 삭제합니다.</p><button onclick="openGlobalReset()">전체 데이터 초기화</button></section></div></section></main>`;
    renderAdminUsers();
    startInboxPolling(data);
    return;
  }
  const avatar = localStorage.getItem("retone-avatar");
  const levels = {
    off: ["AI 끄기", "AI 점검을 사용하지 않아요"],
    light: ["가볍게", "강한 욕설만 빠르게 확인해요"],
    standard: ["균형 있게", "말투·출처가 중요한 주장만 확인해요"],
    careful: ["꼼꼼하게", "중요 정보와 표현을 조금 더 살펴봐요"],
  };
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>설정</h1></header><div class="content settings-page"><header class="settings-intro"><span>나에게 맞춘 Re:Tone</span><h2>${esc(signedIn)}님, 필요한 순간에만 도울게요.</h2><p>전체 기본값은 간단하게 정하고, 필요한 항목만 열어 조절할 수 있어요.</p></header><section class="settings-card settings-profile-card"><label class="room"><span class="avatar">${avatar ? `<img src="${avatar}">` : esc(signedIn[0])}</span><span class="copy"><b>프로필 사진</b><span>사진을 선택하면 이 기기에서 바로 적용돼요.</span></span><span class="settings-card-action">변경</span><input hidden type="file" accept="image/*" onchange="setAvatar(this)"></label></section><section class="ai-preferences settings-card"><header><span>AI 대화 도움</span><h2>얼마나 세심하게 볼까요?</h2><p>일상적인 말은 그대로 두고, 필요한 부분만 조용히 제안해요.</p></header><div class="ai-level-grid">${Object.entries(
    levels,
  )
    .map(
      ([key, [title, desc]]) =>
        `<button data-ai-level="${key}" class="ai-level ${aiIntervention === key ? "selected" : ""}" onclick="setAiIntervention('${key}')"><strong>${title}</strong><span>${desc}</span></button>`,
    )
    .join(
      "",
    )}</div><div class="ai-toggles"></div></section><section id="settings-app-actions" class="settings-app-actions"></section><button class="room settings-logout" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>이 기기에서 안전하게 로그아웃해요.</span></span></button></div></section></main>`;
  if (avatar) {
    document.querySelector(".settings-profile-card")?.insertAdjacentHTML(
      "beforeend",
      `<button class="profile-reset" onclick="resetAvatar()">기본 이미지로 초기화</button>`,
    );
  }
  renderDetailedAiSettings();
  startInboxPolling(data);
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
function openGlobalReset() {
  popup(
    `<div class="delete-account-card global-reset-card"><div class="delete-account-icon">!</div><span>되돌릴 수 없는 관리자 작업</span><h2>전체 서비스 데이터를 초기화할까요?</h2><p>모든 계정, 친구 관계, 채팅방, 메시지, 사진, 일정, 반응, AI 문의와 확인 기록을 삭제해요.</p><label>관리자 비밀번호<input id="global-reset-password" type="password" placeholder="관리자 비밀번호를 입력해주세요"></label><label>2차 인증 코드<input id="global-reset-two-factor" type="password" inputmode="numeric" placeholder="2차 인증 코드를 입력해주세요"></label><label>확인 문구<input id="global-reset-confirmation" placeholder="초기화 를 입력해주세요"></label><small>실행하려면 위 칸에 <b>초기화</b>를 정확히 입력해주세요.</small><div class="modal-actions"><button class="quiet" onclick="closePopup()">취소</button><button class="danger-action" id="global-reset-action" onclick="confirmGlobalReset()">전체 초기화</button></div></div>`,
  );
}
async function confirmGlobalReset() {
  const password = document.querySelector("#global-reset-password")?.value || "";
  const two_factor = document.querySelector("#global-reset-two-factor")?.value || "";
  const confirmation = document.querySelector("#global-reset-confirmation")?.value || "";
  if (!password || !two_factor) return alert("관리자 비밀번호와 2차 인증 코드를 모두 입력해주세요.");
  if (confirmation.trim() !== "초기화") return alert("확인 문구로 ‘초기화’를 정확히 입력해주세요.");
  const action = document.querySelector("#global-reset-action");
  if (action) {
    action.disabled = true;
    action.textContent = "초기화 중…";
  }
  try {
    const result = await api("/api/admin/clear-user-data", {
      method: "POST",
      body: JSON.stringify({ password, two_factor, confirmation }),
    });
    if (!result.ok) throw new Error();
    closePopup();
    popup(
      `<div class="ai-check info"><h2>전체 초기화가 완료됐어요.</h2><p>계정과 소통 데이터, AI 확인 기록을 모두 삭제했어요.</p><button onclick="closePopup();settings()">확인</button></div>`,
    );
  } catch {
    if (action) {
      action.disabled = false;
      action.textContent = "전체 초기화";
    }
    alert("초기화하지 못했어요. 관리자 인증 정보와 서버 상태를 확인해주세요.");
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
    "채팅방 위의 대화 흐름 버튼을 눌렀을 때만 최근 맥락을 정리해요.",
    ["끄기", "눌렀을 때만"],
  ],
  [
    "이미지 안전 안내",
    "사진 전송 전 선정성·불쾌감 가능성을 안내해요. 경고 후에도 직접 선택해 보낼 수 있어요.",
    ["끄기", "필요할 때", "민감하게"],
  ],
  [
    "대화 흐름 참고",
    "표현이 반복해서 엇갈릴 수 있을 때만 작게 알려줘요. 감정이나 잘잘못을 판단하지 않아요.",
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
      "대화 흐름 참고",
      "대화 복구 문장",
    ],
  ],
];
function renderDetailedAiSettings() {
  const root = document.querySelector(".ai-toggles");
  if (!root) return;
  const keepAdvancedOpen = Boolean(root.querySelector(".ai-advanced-settings")?.open);
  const keepGroupsOpen = new Set(
    Array.from(root.querySelectorAll(".ai-setting-group[open]"), (group) => group.querySelector("summary b")?.textContent).filter(Boolean),
  );
  const sensitivity = sensitivityState();
  const saved = aiDetails(false);
  const card = (name) => {
    const [, desc, options] = aiCategories.find(([title]) => title === name);
    return `<article class="ai-category"><span><b>${name}</b><small>${desc}</small></span><div class="ai-choice-row">${options.map((option) => `<button class="${saved[name] === option ? "selected" : ""}" onclick="saveAiDetail(this,'${name}','${option}')">${option}</button>`).join("")}</div></article>`;
  };
  root.innerHTML = `<section class="overall-sensitivity"><span>기본 AI 민감도</span><b id="overall-sensitivity-label">${sensitivityLabel(sensitivity.overall)} · ${sensitivity.overall}</b><input type="range" min="0" max="100" value="${sensitivity.overall}" style="--sensitivity:${sensitivity.overall}%" oninput="previewOverallSensitivity(this.value,this)" onchange="setOverallSensitivity(this.value)"><small>모든 채팅방의 기본값이에요. 친한 친구 방은 방 설정에서 따로 낮출 수 있어요.</small><button class="ai-connection-button" onclick="checkAiConnection()">OpenAI 연결 확인</button></section><details class="ai-advanced-settings"><summary><span><b>세부 항목 조절</b><small>필요한 항목만 열어, 내 대화 방식에 맞춰요.</small></span><i>⌄</i></summary><div class="ai-setting-intro"><b>‘그냥 보내기’ 선택도 반영해요</b><span>${esc(learningNote())}</span></div>${aiGroups.map(([title, desc, names]) => `<details class="ai-setting-group"><summary><span><b>${title}</b><small>${desc}</small></span><i>⌄</i></summary><div class="ai-category-list">${names.map(card).join("")}</div></details>`).join("")}</details>`;
  const advanced = root.querySelector(".ai-advanced-settings");
  if (advanced) advanced.open = keepAdvancedOpen;
  root.querySelectorAll(".ai-setting-group").forEach((group) => {
    group.open = keepGroupsOpen.has(group.querySelector("summary b")?.textContent);
  });
  const actions = document.querySelector("#settings-app-actions");
  if (actions)
    actions.innerHTML = `<section class="settings-actions"><button class="theme-toggle" onclick="toggleTheme()">${document.body.classList.contains("dark") ? "☀️ 라이트 모드" : "🌙 다크 모드"}</button><button class="notification-toggle" onclick="toggleBrowserNotifications()">${browserNotificationsEnabled() ? "🔔 새 메시지 알림 켬" : "🔕 새 메시지 알림 켜기"}</button><button class="danger-action" onclick="openDeleteAccount()">회원 탈퇴</button></section>`;
}
async function checkAiConnection() {
  popup(`<div class="ai-check info analysis-loading"><div class="thinking-loader" aria-label="OpenAI 연결 확인 중"><i></i><i></i><i></i></div><span>AI 연결 확인</span><h2>OpenAI와 연결되는지 확인하고 있어요</h2></div>`);
  try {
    const result = await api("/api/ai/status");
    const messages = {
      connected: ["연결이 정상이에요", "사전에 없는 문장도 전송 후 맥락 검사에서 OpenAI가 확인해요."],
      missing: ["API 키가 설정되지 않았어요", "Render 환경 변수에 OPENAI_API_KEY를 저장해야 해요."],
      invalid_key: ["API 키를 사용할 수 없어요", "키가 잘못됐거나 해당 프로젝트에서 사용할 권한이 없는지 확인해주세요."],
      quota_or_rate_limit: ["사용량 또는 호출 제한을 확인해주세요", "API 크레딧과 프로젝트 사용 한도를 확인한 뒤 다시 시도해주세요."],
      unreachable: ["OpenAI 서버에 연결하지 못했어요", "잠시 후 다시 시도하거나 Render의 외부 연결 상태를 확인해주세요."],
      api_error: ["OpenAI 응답을 확인하지 못했어요", "잠시 후 다시 확인해주세요."],
    };
    const [title, copy] = messages[result.state] || messages.api_error;
    popup(`<div class="ai-check ${result.connected ? "info" : "warn"}"><span>AI 연결 상태</span><h2>${title}</h2><p>${copy}</p><button onclick="closePopup()">확인</button></div>`);
  } catch {
    popup(`<div class="ai-check warn"><span>AI 연결 상태</span><h2>상태를 확인하지 못했어요</h2><p>로그인 상태나 서버 배포 상태를 확인해주세요.</p><button onclick="closePopup()">확인</button></div>`);
  }
}
function saveAiDetail(button, name, value) {
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
  button?.closest(".ai-choice-row")?.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
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
    `<div class="delete-account-card"><div class="delete-account-icon">!</div><span>회원 탈퇴</span><h2>정말 탈퇴할까요?</h2><p>탈퇴하면 이 계정으로 다시 로그인할 수 없고, 프로필 정보와 로그인 세션이 삭제돼요.</p><label>현재 이름<input id="delete-name" placeholder="이름을 입력해주세요"></label><label>현재 비밀번호${passwordField("delete-password", "비밀번호를 입력해주세요", "autocomplete=\"current-password\"")}</label><small>기존 대화는 상대방의 대화 기록을 위해 ‘탈퇴한 사용자’로만 남아요.</small><div class="modal-actions"><button class="quiet" onclick="closePopup()">취소</button><button class="danger-action" onclick="deleteMyAccount()">회원 탈퇴</button></div></div>`,
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
    popup(
      `<div class="ai-check info"><span>회원 탈퇴 완료</span><h2>계정이 안전하게 탈퇴 처리됐어요.</h2><p>이 기기에서도 로그아웃됐어요. 필요하면 새 계정으로 다시 시작할 수 있어요.</p><button onclick="closePopup()">확인</button></div>`,
    );
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
  const presets = {
    off: Object.fromEntries(sensitivityKeys.map((key) => [key, 0])),
    light: { ...defaultSensitivityCategories(), "강한 공격 표현": 25, "비꼼·압박 표현": 0, "출처 확인 제안": 0, "대화 흐름 참고": 0, "대화 복구 문장": 0 },
    standard: defaultSensitivityCategories(),
    careful: Object.fromEntries(sensitivityKeys.map((key) => [key, 75])),
  };
  state.categories = presets[level] || defaultSensitivityCategories();
  saveSensitivity(state);
  const user = await api(`/api/users/${signedInId}/preferences`, {
    method: "PATCH",
    body: JSON.stringify({ ai_intervention: level }),
  });
  aiIntervention = user.ai_intervention;
  sessionStorage.setItem("retone-v2-ai-level", aiIntervention);
  document.querySelectorAll("[data-ai-level]").forEach((button) =>
    button.classList.toggle("selected", button.dataset.aiLevel === aiIntervention),
  );
  renderDetailedAiSettings();
}
async function logout() {
  try { await api("/api/auth/logout", {method:"POST"}); }
  catch { return alert("로그아웃을 완료하지 못했어요. 연결을 확인하고 다시 눌러 주세요."); }
  roomLoadVersion += 1;
  stopRoomPolling();
  stopInboxPolling();
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
async function resetAvatar() {
  popup(
    `<div class="ai-check info"><span>프로필 사진 초기화</span><h2>기본 이미지로 돌아갈까요?</h2><p>등록한 프로필 사진 대신 이름의 첫 글자가 표시돼요.</p><div class="modal-actions"><button class="quiet" onclick="closePopup()">취소</button><button onclick="confirmResetAvatar()">초기화</button></div></div>`,
  );
}
async function confirmResetAvatar() {
  try {
    await api(`/api/users/${signedInId}/avatar`, { method: "DELETE" });
    localStorage.removeItem("retone-avatar");
    closePopup();
    settings();
  } catch {
    popup(`<div class="ai-check warn"><h2>프로필 사진을 초기화하지 못했어요</h2><p>연결 상태를 확인한 뒤 다시 시도해주세요.</p><button onclick="closePopup()">확인</button></div>`);
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
    localStorage.setItem("retone-citations-v3", JSON.stringify(factFindings));
  } catch {}
}
async function queueFactChecks(messages) {
  if (aiDetails()["출처 확인 제안"] === "끄기") return;
  const candidates = messages
    .filter((message) => !message.mine && likelyFactualClaim(message.body))
    .slice(-3);
  for (const message of candidates) {
    if (
      factFindings[message.id]?.version === FACT_FINDING_VERSION ||
      factChecksInFlight.has(message.id)
    )
      continue;
    factChecksInFlight.add(message.id);
    try {
      const result = await api("/api/ai/fact-check", {
        method: "POST",
        body: JSON.stringify({ message_id: message.id }),
      });
      factFindings[message.id] = { ...result, version: FACT_FINDING_VERSION };
      saveFactFindings();
      if (roomId === message.room_id && (result.status === "check" || result.sources?.length))
        refreshFactCue(message);
    } catch {
      // 연결 실패는 조용히 넘기며, 사용자가 다시 눌러 확인할 수 있게 둡니다.
    } finally {
      factChecksInFlight.delete(message.id);
    }
  }
}
function refreshFactCue(message) {
  const node = document.querySelector(`.bubble[data-message-id="${message.id}"]`);
  if (node) node.outerHTML=view(message);
}
function view(m) {
  const finding = !m.mine && factFindings[m.id]?.version === FACT_FINDING_VERSION ? factFindings[m.id] : null;
  const hasSources = Array.isArray(finding?.sources) && finding.sources.length > 0;
  const factCue =
    finding?.status === "check" || hasSources
      ? `<button class="fact-cue ${finding.status === "check" ? "needs-check" : ""}" title="${finding.status === "check" ? "출처를 한 번 더 확인해 보세요" : "관련 출처 보기"}" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();openFactFinding('${m.id}')">ⓘ<span>출처</span></button>`
      : "";
  const contextCue =
    m.mine && m.ai_verdict === "WARN"
      ? `<button class="context-tone-cue" title="앞 대화와 함께 확인한 AI 제안" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();openContextToneFinding('${m.id}')"><span>AI</span> 맥락 제안</button>`
      : "";
  const messageMenu = m.mine
    ? `<button class="message-menu" title="메시지 관리" aria-label="메시지 관리" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();openMessageActions('${m.id}')"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>`
    : "";
  const original = m.reply_to
    ? currentRoomMessages.find((message) => message.id === m.reply_to)
    : null;
  const quote = m.reply_to
    ? `<button class="reply-quote" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();focusReply('${m.reply_to}')"><b>${esc(original?.sender || "삭제된 메시지")}</b><span>${esc(original?.body || (original?.image_url ? "사진" : "원문을 찾을 수 없어요"))}</span></button>`
    : "";
  const replyButton = `<button class="reply-shortcut" title="답장" aria-label="답장" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();startReply('${m.id}')"><span>↩</span><em>답장</em></button>`;
  const tap = m.mine ? "" : `onclick="handleMessageTap('${m.id}')"`;
  const press = `onpointerdown="beginMessagePress(event,'${m.id}',${m.mine})" onpointerup="endMessageGesture(event,'${m.id}',${m.mine})" onpointerleave="endMessageGesture(event,'${m.id}',${m.mine})" onpointermove="trackMessageSwipe(event,'${m.id}',${m.mine})" onpointercancel="cancelMessagePress(true)" oncontextmenu="return false"`;
  const image = m.image_url
    ? `<button type="button" class="chat-image-button" aria-label="사진 크게 보기" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();openImageViewer('${m.id}')"><img class="chat-image" src="${escAttr(m.image_url)}" alt="${escAttr(m.sender)}님이 보낸 사진"></button><small class="image-message-label">눌러서 크게 보기</small>`
    : "";
  return `<article class="bubble ${m.mine ? "mine" : ""}" data-message-id="${esc(m.id)}" ${tap} ${press}><div class="meta"><span>${esc(m.sender)}</span>${messageMenu}</div>${quote}${image}${m.body ? `<span>${esc(m.body)}</span>` : ""}<div class="bubble-tools">${contextCue}${factCue}${replyButton}${m.mine && m.unread ? `<span class="read">${m.unread}</span>` : ""}</div></article>`;
}
function openImageViewer(id) {
  const message = currentRoomMessages.find((item) => item.id === id);
  if (!message?.image_url) return;
  popup(`<div class="image-viewer"><div class="image-viewer-head"><span>${esc(message.sender)}님의 사진</span><button type="button" aria-label="사진 닫기" onclick="closePopup()">×</button></div><img src="${escAttr(message.image_url)}" alt="${escAttr(message.sender)}님이 보낸 사진"><small>화면 바깥을 누르면 닫혀요.</small></div>`);
}
function openContextToneFinding(id) {
  const message = currentRoomMessages.find((item) => item.id === id);
  if (!message?.ai_suggestion) return;
  const evidence = message.ai_trigger
    ? `<p>맥락에서 눈에 띈 표현 · <q>${esc(message.ai_trigger)}</q></p>`
    : "";
  popup(`<div class="ai-check warn context-tone-result"><span>전송 후 맥락 확인</span><h2>앞 대화와 함께 보면 이렇게 들릴 수도 있어요</h2>${evidence}<p class="ai-suggestion">${esc(message.ai_suggestion)}</p><small>이미 전송된 메시지를 막거나 판단하지 않고, 다음 대화에 참고할 수 있는 제안이에요.</small><button onclick="closePopup()">확인</button></div>`);
}
async function queueContextToneCheck(room, messageId) {
  const toneEnabled = activeAiIntervention() !== "off" && aiDetails()["비꼼·압박 표현"] !== "끄기";
  const alignmentEnabled = activeAiIntervention() !== "off" && aiDetails()["말맞춤 카드"] !== "끄기";
  if (!messageId || contextChecksInFlight.has(messageId) || (!toneEnabled && !alignmentEnabled)) return;
  contextChecksInFlight.add(messageId);
  if (roomId === room) setAiStatus("보낸 문장을 앞 대화와 함께 확인 중", true);
  try {
    const result = await api(`/api/rooms/${room}/messages/${messageId}`, {method:"POST"});
    const message = currentRoomMessages.find((item) => item.id === messageId);
    if (message) {
      message.ai_verdict = result.verdict;
      message.ai_suggestion = result.suggestion;
      message.ai_trigger = result.trigger;
      message.alignment_hint = Boolean(result.alignment_hint);
      message.alignment_kind = result.alignment_kind || null;
      message.alignment_summary = result.alignment_summary || null;
      const node = document.querySelector(`.bubble[data-message-id="${messageId}"]`);
      if (node) node.outerHTML = view(message);
      updateFragment("#alignment-slot", alignmentCard(currentRoomMessages));
    } else if (roomId === room && (result.verdict === "WARN" || result.alignment_hint)) {
      await refreshRoom(room);
    }
    if (roomId === room) setAiStatus(result.alignment_hint ? "약속·계획 말맞춤 카드를 준비했어요" : result.verdict === "WARN" ? "맥락을 확인한 제안이 있어요" : "맥락 확인 완료");
  } catch (error) {
    if (roomId === room) setAiStatus(error.status === 502 || error.status === 503 ? "AI 연결을 확인해주세요" : "맥락 확인을 잠시 후 다시 시도할게요");
  } finally {
    contextChecksInFlight.delete(messageId);
  }
}
function beginMessagePress(event, id, mine) {
  cancelMessagePress();
  messageSwipe = {
    id,
    mine,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    horizontal: false,
    activated: false,
    target: event.currentTarget,
  };
  // 마우스는 드래그로 답장하고, 터치에서는 꾹 눌러도 기존 작업 메뉴를 열 수 있어요.
  if (event.pointerType !== "mouse") {
    messagePressTimer = setTimeout(() => {
      if (!messageSwipe || messageSwipe.id !== id || messageSwipe.horizontal) return;
      messagePressTimer = null;
      suppressMessageTapUntil = Date.now() + 700;
      navigator.vibrate?.(10);
      openPressedMessageActions(id);
    }, 480);
  }
}
function trackMessageSwipe(event, id, mine) {
  const swipe = messageSwipe;
  if (!swipe || swipe.id !== id || swipe.pointerId !== event.pointerId) return;
  const dx = event.clientX - swipe.startX;
  const dy = event.clientY - swipe.startY;
  if (!swipe.horizontal && (Math.abs(dx) > 7 || Math.abs(dy) > 7)) {
    cancelMessagePress();
    swipe.horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
  }
  if (!swipe.horizontal) return;
  const expected = mine ? Math.min(0, dx) : Math.max(0, dx);
  const distance = Math.min(66, Math.abs(expected));
  swipe.activated = distance >= 42;
  swipe.target.classList.toggle("reply-swipe-ready", swipe.activated);
  swipe.target.style.setProperty("--reply-swipe", `${expected * 0.42}px`);
  event.preventDefault();
}
function endMessageGesture(event, id, mine) {
  const swipe = messageSwipe;
  if (!swipe || swipe.id !== id || swipe.pointerId !== event.pointerId) {
    cancelMessagePress();
    return;
  }
  const shouldReply = swipe.horizontal && swipe.activated;
  swipe.target.style.removeProperty("--reply-swipe");
  swipe.target.classList.remove("reply-swipe-ready");
  messageSwipe = null;
  cancelMessagePress();
  if (shouldReply) {
    suppressMessageTapUntil = Date.now() + 500;
    startReply(id);
  }
}
function cancelMessagePress(resetSwipe = false) {
  if (messagePressTimer) clearTimeout(messagePressTimer);
  messagePressTimer = null;
  if (resetSwipe && messageSwipe) {
    messageSwipe.target?.style.removeProperty("--reply-swipe");
    messageSwipe.target?.classList.remove("reply-swipe-ready");
    messageSwipe = null;
  }
}
function handleMessageTap(id) {
  if (Date.now() < suppressMessageTapUntil) return;
  const message = currentRoomMessages.find((item) => item.id === id);
  if (message && !message.mine) inspectMessage(message.id);
}
function openPressedMessageActions(id) {
  const message = currentRoomMessages.find((item) => item.id === id);
  if (!message) return;
  const preview = message.body
    ? `<p class="message-action-preview">${esc(message.body)}</p>`
    : `<p class="message-action-preview image">사진을 보낸 메시지</p>`;
  const remove = message.mine
    ? `<button class="danger-action" onclick="removeMessage('${id}')">메시지 삭제</button>`
    : "";
  popup(`<div class="message-action-sheet"><span>메시지</span><h2>어떤 작업을 할까요?</h2>${preview}<div class="message-action-buttons"><button class="quiet" onclick="startReply('${id}')">↩ 답장</button>${remove}</div><button class="sheet-cancel" onclick="closePopup()">취소</button></div>`);
}
function replyComposer() {
  if (!replyingTo) return "";
  const summary = replyingTo.body || (replyingTo.image_url ? "사진" : "메시지");
  return `<div class="reply-composer"><span>↩ <b>${esc(replyingTo.sender)}</b>에게 답장</span><small>${esc(summary)}</small><button type="button" title="답장 취소" aria-label="답장 취소" onclick="cancelReply()">×</button></div>`;
}
function startReply(id) {
  const message = currentRoomMessages.find((item) => item.id === id);
  if (!message) return;
  replyingTo = message;
  closePopup();
  updateFragment("#reply-slot", replyComposer());
  document.querySelector("#text")?.focus({ preventScroll: true });
}
function cancelReply() {
  replyingTo = null;
  updateFragment("#reply-slot", "");
  document.querySelector("#text")?.focus({ preventScroll: true });
}
function focusReply(id) {
  const target = document.querySelector(`[data-message-id="${id}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("reply-focused");
  setTimeout(() => target.classList.remove("reply-focused"), 900);
}
function conversationPulse() {
  if (aiDetails()["대화 흐름 요약"] === "끄기") return "";
  return `<button class="conversation-pulse" onclick="openConflictGuide()"><span>대화 흐름</span><b>눌러서 분석</b></button>`;
}
function openConversationPulse() {
  popup(
    `<div class="ai-check info"><span>대화 흐름 참고</span><h2>필요할 때만 최근 맥락을 정리해요.</h2><p>대화 온도나 사람의 감정을 단정하지 않고, 실제 주제와 엇갈릴 수 있는 지점만 참고로 보여줘요.</p><button onclick="closePopup()">확인</button></div>`,
  );
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
  const levels = [
    ["off", "AI 끄기", "이 방에서는 점검하지 않아요"],
    ["light", "가볍게", "강한 표현만 확인해요"],
    ["standard", "균형 있게", "공격 표현과 말맞춤을 확인해요"],
    ["careful", "꼼꼼하게", "비꼼과 맥락까지 세심하게 확인해요"],
  ];
  popup(`<div class="ai-check info quick-ai-settings"><span>이 채팅방 AI</span><h2>도움 정도를 바로 바꿔요</h2><p>설정은 이 채팅방에만 적용되며 언제든 다시 바꿀 수 있어요.</p><div class="choice-stack">${levels.map(([key,title,desc])=>`<button class="${activeAiIntervention()===key?"selected":""}" onclick="setQuickRoomAi('${key}')"><b>${title}</b><small>${desc}</small></button>`).join("")}</div></div>`);
}
function setQuickRoomAi(level) {
  saveRoomAiConfig({...roomAiConfig(), mode:level});
  closePopup();
  document.querySelector("#text")?.focus({preventScroll:true});
}
function viewReflection(item) {
  const remove = item.owner_id === signedInId ? `<button class="reflection-delete" onclick="confirmDeleteReflection('${item.id}')">삭제</button>` : "";
  return `<article class="reflection-card"><span>↻ 약속 회고</span><b>${esc(item.title)}</b><p><strong>계속할 점</strong> ${esc(item.keep || "아직 작성하지 않았어요")}</p><p><strong>다음에는</strong> ${esc(item.next || "아직 작성하지 않았어요")}</p>${remove}</article>`;
}
function viewAppointment(item) {
  const ownerAction = item.owner_id === signedInId ? `<button class="quiet danger" onclick="confirmDeleteAppointment('${item.id}')">모두에게 삭제</button>` : "";
  const alreadyApproved = item.pending_change?.approvals?.includes(signedInId);
  const pending = item.pending_change ? `<p class="appointment-pending"><strong>변경 동의 대기</strong> ${item.pending_change.approvals.length}/${item.pending_change.required}</p>${alreadyApproved?`<small class="appointment-waiting">내 동의 완료 · 다른 구성원을 기다리는 중</small>`:`<button onclick="approveAppointmentChange('${item.id}')">변경안 동의</button>`}` : "";
  return `<article class="appointment-card"><span>◷ 함께 정한 약속</span><b>${esc(item.title)}</b><p><strong>${esc(item.date)}</strong>${item.place ? ` · ${esc(item.place)}` : ""}</p>${(item.fields||[]).map(f=>`<p><strong>${esc(f.label)}</strong> · ${esc(f.value)}</p>`).join("")}${pending}<div class="appointment-actions">${item.pending_change?"":`<button class="quiet" onclick="editAppointment('${item.id}')">수정 제안</button>`}<button class="quiet" onclick="hideAppointment('${item.id}')">내 화면에서 숨기기</button>${ownerAction}</div></article>`;
}

function visibleAppointments(items) {
  return [...items]
    .filter((item)=>localStorage.getItem(`retone-appointment-hidden-${signedInId}-${item.id}`)!=="1")
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
function appointmentTime(item) {
  const value = new Date(String(item?.date || "").replace(" ", "T")).getTime();
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}
function appointmentNotice(items) {
  const visible = visibleAppointments(items);
  if (!visible.length) return "";
  const now = Date.now();
  const past = visible
    .filter((item)=>appointmentTime(item)<now && localStorage.getItem(`retone-appointment-past-seen-${signedInId}-${item.id}`)!=="1")
    .sort((a,b)=>appointmentTime(b)-appointmentTime(a))[0];
  if (past) {
    return `<div class="appointment-notice past"><button class="appointment-notice-body" onclick="openAppointmentDetails('${past.id}')"><span class="appointment-notice-icon">✓</span><span><small>지난 일정 · 확인이 필요해요</small><b>${esc(past.title)}</b><em>${esc(past.date)}${past.place?` · ${esc(past.place)}`:""}</em></span><i>›</i></button><button class="past-appointment-confirm" onclick="acknowledgePastAppointment('${past.id}')">확인</button></div>`;
  }
  const item = visible.find((appointment)=>appointmentTime(appointment)>=now);
  if (!item) return "";
  return `<button class="appointment-notice" onclick="openAppointmentDetails('${item.id}')"><span class="appointment-notice-icon">◷</span><span><small>약속 공지${visible.length>1?` · 외 ${visible.length-1}개`:""}</small><b>${esc(item.title)}</b><em>${esc(item.date)}${item.place?` · ${esc(item.place)}`:""}</em></span><i>›</i></button>`;
}
function acknowledgePastAppointment(id) {
  localStorage.setItem(`retone-appointment-past-seen-${signedInId}-${id}`, "1");
  if (roomId) syncRoomExtras(roomId,currentRoomMessages);
}
function openAppointmentDetails(id) {
  const item=(data.appointments||[]).find((appointment)=>appointment.id===id);
  if (!item) return alert("약속을 찾지 못했어요.");
  const canApprove=item.pending_change && !item.pending_change.approvals?.includes(signedInId);
  popup(`<div class="appointment-detail"><span>◷ 약속 공지</span><h2>${esc(item.title)}</h2><p><strong>날짜와 시간</strong><br>${esc(item.date)}</p><p><strong>장소</strong><br>${esc(item.place||"장소 미정")}</p>${(item.fields||[]).map(field=>`<p><strong>${esc(field.label)}</strong><br>${esc(field.value)}</p>`).join("")}${item.pending_change?`<div class="appointment-change-preview"><b>수정 제안이 있어요</b><span>${esc(item.pending_change.title)} · ${esc(item.pending_change.date)}</span><small>동의 ${item.pending_change.approvals.length}/${item.pending_change.required}</small></div>`:""}<div class="modal-actions"><button class="quiet" onclick="closePopup();hideAppointment('${item.id}')">내 화면에서 숨기기</button>${item.pending_change?"":`<button onclick="closePopup();editAppointment('${item.id}')">수정 제안</button>`}${canApprove?`<button onclick="approveAppointmentChange('${item.id}')">변경안 동의</button>`:""}</div></div>`);
}
function hideAppointment(id) {
  localStorage.setItem(`retone-appointment-hidden-${signedInId}-${id}`,"1");
  closePopup();
  if (roomId) syncRoomExtras(roomId,currentRoomMessages);
}
function localDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function setQuickDate(inputId, offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(18, 0, 0, 0);
  const input = document.querySelector(`#${inputId}`);
  if (input) {
    input.value = localDateTimeValue(date);
    input.focus();
  }
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
        item.mine && item.alignment_hint && !(data.appointments || []).some(a=>a.source_message_id === item.id) && !(data.agreements || []).some(a=>a.source_message_id === item.id) &&
        localStorage.getItem(`retone-alignment-dismissed-${item.id}`) !== "1",
    );
  if (!message) return "";
  const planning = message.alignment_kind === "plan";
  const title = planning ? "함께할 일을 계획하는 대화 같아요." : "약속을 정하는 대화 같아요.";
  const summary = message.alignment_summary || message.body;
  const help = planning ? "담당자·기한·준비할 내용을 함께 맞춰볼까요?" : "시간·장소·할 일을 함께 맞춰볼까요?";
  return `<article class="alignment-card"><span>✦ 말맞춤 제안 · ${planning ? "계획" : "약속"}</span><b>${title}</b><p>‘${esc(summary)}’ — ${help}</p><div><button onclick="openAlignmentCard('${message.id}')">${planning ? "계획 카드 만들기" : "약속 카드 만들기"}</button><button class="quiet" onclick="dismissAlignment('${message.id}')">나중에</button></div></article>`;
}
function dismissAlignment(id) {
  localStorage.setItem(`retone-alignment-dismissed-${id}`, "1");
  openRoom(roomId);
}
function openAlignmentCard(id) {
  const message = currentRoomMessages.find((item) => item.id === id);
  if (message?.alignment_kind === "plan") return newAgreement(message.alignment_summary || message.body || "", id);
  popup(appointmentEditorMarkup(null, id, message?.alignment_summary || message?.body || ""));
}
function inspectMessage(id) {
  popup(
    `<div class="ai-check info"><span>상대 메시지</span><h2>이 메시지를 함께 살펴볼까요?</h2><p>Re:Tone은 진실·거짓을 판정하지 않고, 확인에 필요한 단서를 제안해요.</p><button id="fact-check-start" onclick="factCheckPending(this, \'${escAttr(id)}\')">사실여부 확인 도움받기</button></div>`,
  );
}
function safeLink(url) {
  const value = String(url || "");
  return /^https?:\/\//i.test(value) ? value.replace(/"/g, "%22") : "";
}
function factFindingMarkup(result) {
  const needsCheck = result.status === "check";
  const sources = (result.sources || [])
    .map((source) => {
      const url = safeLink(source.url);
      if (!url) return "";
      return `<a href="${url}" target="_blank" rel="noreferrer"><b>${esc(source.title || "출처 열기")}</b>${source.note ? `<p>${esc(source.note)}</p>` : ""}${source.date ? `<small>${esc(source.date)}</small>` : ""}<span>열기 ↗</span></a>`;
    })
    .join("");
  const heading = needsCheck ? "출처를 한 번 더 확인해 볼까요?" : "관련 출처를 찾았어요";
  const fallback = needsCheck
    ? "출처마다 내용이나 날짜가 다를 수 있어요. 아래 자료를 함께 확인해 보세요."
    : "이 메시지와 관련된 출처를 모아봤어요. 어떤 출처가 무엇을 말하는지 직접 확인해 보세요.";
  return `<div class="ai-check info fact-finding ${needsCheck ? "needs-check" : ""}"><span>${needsCheck ? "출처 확인 제안" : "출처 찾아보기"}</span><h2>${heading}</h2><p>${esc(result.summary || fallback)}</p>${sources ? `<div class="fact-sources">${sources}</div>` : ""}<small>각 출처의 내용을 참고용으로 모은 것이며, Re:Tone은 이 메시지가 사실인지 거짓인지 판정하지 않아요.</small><button onclick="closePopup()">확인</button></div>`;
}
function openFactFinding(id) {
  const result = factFindings[id];
  if (result) popup(factFindingMarkup(result));
}
async function factCheckPending(button, id) {
  const modal = button.closest(".modal");
  if (!modal || button.disabled) return;
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="thinking-loader" aria-hidden="true"><i></i><i></i><i></i></span>출처를 찾고 있어요`;
  }
  try {
    const result = await api("/api/ai/fact-check", {
      method: "POST",
      body: JSON.stringify({ message_id:id }),
    });
    if (!modal.isConnected) return;
    modal.remove();
    if (result.status === "unavailable") {
      popup(`<div class="ai-check info"><span>출처 찾아보기</span><h2>지금은 출처 확인을 연결하지 못했어요</h2><p>${esc(result.summary || "잠시 뒤 다시 시도하거나, 원문과 날짜를 함께 확인해 보세요.")}</p><button onclick="closePopup()">확인</button></div>`);
    } else if (result.status === "check" || result.sources?.length) {
      popup(factFindingMarkup(result));
    } else {
      popup(`<div class="ai-check info"><span>출처 찾아보기</span><h2>관련 출처를 찾지 못했어요</h2><p>이 메시지의 출처나 작성 날짜를 직접 물어보거나, 조금 더 구체적인 검색어로 확인해 보세요.</p><small>Re:Tone은 이 메시지가 사실인지 거짓인지 판정하지 않아요.</small><button onclick="closePopup()">확인</button></div>`);
    }
  } catch (error) {
    if (!modal.isConnected) return;
    modal.remove();
    popup(`<div class="ai-check warn"><span>출처 찾아보기</span><h2>출처 확인을 불러오지 못했어요</h2><p>${error.status===422?"900자 이하의 텍스트 메시지에서 확인할 수 있어요.":"잠시 후 다시 눌러 주세요."}</p><button onclick="closePopup()">확인</button></div>`);
  }
}
function openAiHelp() {
  if (aiDetails()["감정 도움 AI"] === "끄기") return;
  popup(
    `<div class="ai-check info ai-help-card"><span>AI 도움받기</span><h2>지금 마음이나 전하고 싶은 말을 적어봐요</h2><p>판단하지 않고, 감정을 정리하거나 상대에게 전할 말을 함께 찾아볼게요.</p><textarea id="ai-help-text" rows="4" placeholder="예: 너무 서운한데 싸우고 싶진 않아" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();askAiHelp()}"></textarea><small class="ai-help-hint">Ctrl/⌘ + Enter로 바로 보낼 수 있어요.</small><div id="ai-help-response" aria-live="polite"></div><button id="ai-help-submit" onclick="askAiHelp()">AI와 이야기하기</button></div>`,
  );
  requestAnimationFrame(() => document.querySelector("#ai-help-text")?.focus());
}
async function askAiHelp() {
  const input = document.querySelector("#ai-help-text");
  const text = input?.value.trim();
  if (!text) return;
  const button = document.querySelector("#ai-help-submit");
  const result = document.querySelector("#ai-help-response");
  if (button) {
    button.disabled = true;
    button.textContent = "생각하고 있어요…";
  }
  if (result)
    result.innerHTML = `<div class="ai-help-loading"><span class="thinking-loader"><i></i><i></i><i></i></span>내 말을 정리하고 있어요.</div>`;
  try {
    const out = await api("/api/ai/support", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (result)
      result.innerHTML = `<article class="ai-help-reply"><b>Re:Tone의 제안</b><p>${esc(out.reply || "지금 느끼는 마음을 차분히 적어보는 것부터 시작해 봐요.").replace(/\n/g, "<br>")}</p></article>`;
    input.value = "";
    input.focus();
  } catch {
    if (result)
      result.innerHTML = `<div class="ai-help-error">지금은 도움을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "AI와 이야기하기";
    }
  }
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
    // Do not call the service for every letter. One pre-check after a natural
    // typing pause preserves fast sending without turning typing into API traffic.
    timer: setTimeout(() => runAiCheck(text), 550),
  };
  setAiStatus("");
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
      phase: "pre_send",
      context: aiContextSnapshot(),
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
      setAiStatus("AI 연결을 확인해주세요");
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
    () => aiPrefetch.result || { verdict: "PASS", source: "unavailable", info: { level: "none" } },
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
  stopTyping();
  const skipAiOnce = rewrittenDraftBypass === body;
  rewrittenDraftBypass = "";
  pendingSend = { body, room: roomId, intent: selectedIntent, replyTo: replyingTo?.id || null };
  replyingTo = null;
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
  if (skipAiOnce) {
    setAiStatus("AI가 다듬은 문장을 보내고 있어요…", true);
    await sendApproved();
    return;
  }
  try {
    showCheckResult(await checkForSend(body));
  } catch {
    showCheckResult({ verdict: "PASS", source: "unavailable", info: { level: "none" } });
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
      reply_to: replyingTo?.id || null,
    }),
  });
  replyingTo = null;
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
  if (["unavailable", "fallback"].includes(result.source)) {
    removePendingBubble();
    popup(`<div class="ai-check warn"><span>AI 연결 확인 필요</span><h2>기본 표현만 확인했어요</h2><p>OpenAI 확인이 연결되지 않아 사전에 없는 비꼼이나 맥락 표현까지는 아직 살피지 못했어요.</p><small>연결되지 않은 상태를 정상 통과처럼 처리하지 않고 알려드려요.</small><div class="modal-actions"><button class="quiet" onclick="retryPendingCheck()">다시 확인</button><button onclick="sendApproved()">기본 검사로 보내기</button></div></div>`);
    return;
  }
  const info = result.info || { level: "none", queries: [] };
  const evidence = result.trigger && pendingSend?.body.includes(result.trigger) ? `<p>짚은 표현 · <q>${esc(result.trigger)}</q></p>` : "";
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
      `<div class="ai-check warn"><span>Re:Tone의 제안</span><h2>이렇게 들릴 수도 있어요</h2>${evidence}${suggestion || "<p>상대에게는 공격적인 표현으로 들릴 수 있어요. 조금 다르게 말해볼까요?</p>"}<small>Re:Tone은 이 문장을 판단하거나 막지 않아요. 선택은 언제나 나에게 있어요.</small><div class="modal-actions">${rewrite}<button onclick="sendDespiteWarning()">그냥 보내기</button></div><button class="report-ai" onclick="reportAiResult()">AI 제안이 이상했나요? 문의하기</button></div>`,
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
async function retryPendingCheck() {
  if (!pendingSend) return;
  closePopup();
  addPendingBubble(pendingSend.body);
  aiPrefetch = { text: pendingSend.body, result: null, promise: null, timer: null };
  try {
    await runAiCheck(pendingSend.body);
    showCheckResult(aiPrefetch.result || {verdict:"PASS",source:"unavailable"});
  } catch {
    showCheckResult({verdict:"PASS",source:"unavailable"});
  }
}
function sendDespiteWarning() {
  if (pendingSend?.result?.verdict === "WARN") {
    const category =
      pendingSend.result.source === "dictionary"
        ? "강한 공격 표현"
        : "비꼼·압박 표현";
    learnFromSendAnyway(category);
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
      editPendingSend(true);
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
  let sentMessage = null;
  closePopup();
  setAiStatus("");
  try {
    sentMessage = await api(`/api/rooms/${next.room}/messages`, {
      method: "POST",
      body: JSON.stringify({
        sender: signedIn,
        sender_id: signedInId,
        body: next.body,
        intent: next.intent,
        reply_to: next.replyTo,
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
  if (roomId === next.room) {
    removePendingBubble();
    const input = document.querySelector("#text");
    if (input) {
      input.disabled = false;
      input.placeholder = "메시지를 입력하세요";
      input.focus({preventScroll:true});
    }
    const intentButton = document.querySelector(".intent-button");
    if (intentButton) intentButton.textContent="✦";
    openRoom(next.room);
  }
  if (sentMessage?.id) queueContextToneCheck(next.room, sentMessage.id);
}
function editPendingSend(allowOnePass = false) {
  const body = pendingSend?.body || "";
  const replyTo = pendingSend?.replyTo;
  // 경고창에서 입력창으로 돌아가는 것은 '취소'가 아니라 새 문장의 편집입니다.
  // 이 상태를 남겨두면 send()가 중복 전송 방지 분기에서 즉시 종료됩니다.
  pendingSend = null;
  replyingTo = replyTo
    ? currentRoomMessages.find((message) => message.id === replyTo) || null
    : null;
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
    if (allowOnePass) {
      rewrittenDraftBypass = body;
      setAiStatus("AI가 다듬은 문장이에요. 그대로 보내거나 더 고쳐도 돼요.");
    } else {
      rewrittenDraftBypass = "";
      queueAiCheck(body);
    }
    if (replyingTo) openRoom(roomId);
  }
}
function openMessageActions(id) {
  const message = currentRoomMessages.find((item) => item.id === id);
  const preview = message?.body
    ? `<p class="message-action-preview">${esc(message.body)}</p>`
    : `<p class="message-action-preview image">사진을 보낸 메시지</p>`;
  popup(
    `<div class="message-action-sheet"><span>내 메시지</span><h2>어떤 작업을 할까요?</h2>${preview}<p class="message-action-note">답장으로 대화의 맥락을 이어가거나, 필요하면 메시지를 삭제할 수 있어요.</p><div class="message-action-buttons"><button class="quiet" onclick="startReply('${id}')">↩ 답장</button><button class="danger-action" onclick="removeMessage('${id}')">메시지 삭제</button></div><button class="sheet-cancel" onclick="closePopup()">취소</button></div>`,
  );
}
async function removeMessage(id) {
  closePopup();
  try {
    await api(
      `/api/rooms/${roomId}/messages/${id}?user_id=${encodeURIComponent(signedInId)}`,
      { method: "DELETE" },
    );
    openRoom(roomId);
  } catch {
    popup(
      `<div class="ai-check warn"><span>삭제하지 못했어요</span><h2>메시지가 그대로 남아 있어요.</h2><p>연결 상태를 확인한 뒤 다시 시도해주세요.</p><button onclick="closePopup()">확인</button></div>`,
    );
  }
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
function passwordField(id, placeholder, attributes = "") {
  return `<span class="password-field"><input id="${id}" type="password" ${attributes} placeholder="${placeholder}"><button type="button" class="password-visibility" aria-label="비밀번호 보기" title="비밀번호 보기" onclick="togglePasswordVisibility('${id}',this)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.7 12s3.3-5.3 9.3-5.3S21.3 12 21.3 12 18 17.3 12 17.3 2.7 12 2.7 12Z"/><circle cx="12" cy="12" r="2.7"/></svg></button></span>`;
}
function togglePasswordVisibility(id, button) {
  const input = document.querySelector(`#${id}`);
  if (!input) return;
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  button.classList.toggle("is-visible", reveal);
  button.setAttribute("aria-label", reveal ? "비밀번호 숨기기" : "비밀번호 보기");
  button.setAttribute("title", reveal ? "비밀번호 숨기기" : "비밀번호 보기");
  input.focus();
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
  try {
    const [relations, memberIds] = await Promise.all([
      api(`/api/friends?user_id=${encodeURIComponent(signedInId)}`),
      api(`/api/rooms/${roomId}/members`),
    ]);
    const existing = new Set(memberIds);
    const users = relations.friends.filter((user) => !existing.has(user.id));
    popup(
      `<div class="invite-friends-card"><span>친구 초대</span><h2>함께할 친구를 골라요</h2><p>이미 이 채팅방에 있는 친구는 목록에 표시하지 않아요.</p><div class="invite-list">${users.length ? users.map((user) => `<label><input type="checkbox" class="invite-user" value="${user.id}"> <b>${esc(user.name)}</b></label>`).join("") : "<small>초대할 수 있는 친구가 없어요. 이미 모두 참여 중이거나 친구를 먼저 추가해주세요.</small>"}</div>${users.length ? '<button onclick="confirmInviteFriends()">선택한 친구 초대</button>' : '<button class="quiet" onclick="closePopup()">확인</button>'}</div>`,
    );
  } catch {
    alert("친구 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
async function confirmInviteFriends() {
  const inviteeIds = selectedInvitees();
  if (!inviteeIds.length) return alert("초대할 친구를 한 명 이상 골라 주세요.");
  const room = data.rooms.find((item) => item.id === roomId);
  if (room && !room.is_group && room.members === 2) {
    pendingRoomInvitees = inviteeIds;
    popup(`<div class="invite-friends-card"><span>단체 채팅 만들기</span><h2>새 단톡방 이름을 정해요</h2><p>개인 채팅에 친구를 더하면 기존 1:1 대화는 그대로 두고 새 단체 채팅방을 만들어요.</p><input id="converted-room-name" maxlength="50" placeholder="예: 우리 셋 모임"><button onclick="createGroupFromDirect()">단체 채팅 만들기</button><button class="quiet" onclick="closePopup()">취소</button></div>`);
    return;
  }
  await addFriendsToCurrentRoom(inviteeIds);
}
async function addFriendsToCurrentRoom(inviteeIds) {
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
async function createGroupFromDirect() {
  const name=document.querySelector("#converted-room-name")?.value.trim();
  if (!name) return alert("단체 채팅방 이름을 입력해주세요.");
  const currentMembers=await api(`/api/rooms/${roomId}/members`);
  const inviteeIds=[...new Set([...currentMembers.filter(id=>id!==signedInId),...pendingRoomInvitees])];
  try {
    const room=await api("/api/rooms",{method:"POST",body:JSON.stringify({name,creator_id:signedInId,invitee_ids:inviteeIds,direct:false})});
    pendingRoomInvitees=[];
    data=await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
    closePopup();
    openRoom(room.id);
  } catch {
    alert("단체 채팅방을 만들지 못했어요. 친구 관계를 확인해주세요.");
  }
}
async function saveRoom() {
  const name = document.querySelector("#roomName").value.trim();
  if (!name) return;
  try {
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
  } catch {
    alert("채팅방을 만들지 못했어요. 초대할 친구와 서버 연결을 다시 확인해주세요.");
  }
}
function newAgreement(task = "", sourceId = "") {
  popup(
    `<div class="schedule-editor" data-source="${escAttr(sourceId)}"><span>공동 확인</span><h2>함께 확인할 일을 만들어요</h2><p>마감일은 달력에서 골라 정확하게 공유할 수 있어요.</p><label>할 일<input id="task" value="${escAttr(task)}" placeholder="예: 발표 자료 초안 정리"></label><label>담당자<input id="assignee" placeholder="예: 원준영"></label><label>마감 날짜와 시간<div class="quick-date"><button type="button" onclick="setQuickDate('deadline',0)">오늘</button><button type="button" onclick="setQuickDate('deadline',1)">내일</button></div><input id="deadline" type="datetime-local"></label><button onclick="saveAgreement()">공동 확인 카드 만들기</button></div>`,
  );
}
async function saveAgreement() {
  const editor = document.querySelector(".schedule-editor");
  const task = document.querySelector("#task").value.trim();
  const deadline = document.querySelector("#deadline").value;
  if (!task || !deadline) return alert("할 일과 마감 날짜·시간을 선택해주세요.");
  try {
    await api("/api/agreements", {
      method: "POST",
      body: JSON.stringify({
        task,
        room_id: roomId,
        assignee: document.querySelector("#assignee").value,
        deadline: deadline.replace("T", " "),
        source_message_id: editor?.dataset.source || null,
      }),
    });
    if (editor?.dataset.source)
      localStorage.setItem(`retone-alignment-dismissed-${editor.dataset.source}`, "1");
    data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
    closePopup();
    openRoom(roomId);
  } catch {
    alert("공동 확인을 만들지 못했어요. 이 방의 참여 상태와 연결을 확인해주세요.");
  }
}
async function answerAgreement(id, action) {
  try {
    await api(`/api/agreements/${id}/${action}`, { method: "POST" });
    data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
    openRoom(roomId);
  } catch {
    alert("공동 확인을 업데이트하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
function newAppointment() {
  popup(appointmentEditorMarkup());
}
function scheduleFieldMarkup(field = {}) {
  return `<div class="schedule-field"><input aria-label="항목 이름" maxlength="30" placeholder="예: 준비물" value="${escAttr(field.label)}"><input aria-label="항목 내용" maxlength="120" placeholder="예: 예매표 2장" value="${escAttr(field.value)}"><button type="button" class="quiet" aria-label="항목 삭제" onclick="this.parentElement.remove()">×</button></div>`;
}
function addScheduleField(button) {
  const host = button.previousElementSibling;
  if (host.children.length >= 12) return alert("세부 항목은 12개까지 추가할 수 있어요.");
  host.insertAdjacentHTML("beforeend",scheduleFieldMarkup());
  host.lastElementChild.firstElementChild.focus();
}
function appointmentEditorMarkup(item = null, sourceId = "", draftTitle = "") {
  const editing = Boolean(item);
  const date = item?.date ? String(item.date).replace(" ", "T").slice(0, 16) : "";
  return `<div class="schedule-editor appointment-editor" data-client="${crypto.randomUUID()}" data-source="${escAttr(sourceId)}" data-room="${escAttr(roomId)}"><span>${editing ? "공동 약속 수정" : "함께할 약속"}</span><h2>${editing ? "서로 약속을 바꿔볼까요?" : "약속을 함께 정해요"}</h2><p>${editing ? "이 방의 참여자는 시간·장소·내용을 최신 계획으로 함께 바꿀 수 있어요." : "회의·보이스톡·만남 일정을 달력에서 골라 바로 공유해요."}</p><label>약속 이름<input id="appointmentTitle" value="${escAttr(item?.title || draftTitle)}" placeholder="예: 발표 방향 짧은 회의"></label><label>날짜와 시간<div class="quick-date"><button type="button" onclick="setQuickDate('appointmentDate',0)">오늘</button><button type="button" onclick="setQuickDate('appointmentDate',1)">내일</button></div><input id="appointmentDate" type="datetime-local" value="${escAttr(date)}"></label><label>장소 또는 온라인 링크<input id="appointmentPlace" value="${escAttr(item?.place === "장소 미정" ? "" : item?.place || "")}" placeholder="예: 교실, 디스코드, Google Meet"></label><div class="schedule-fields">${(item?.fields || []).map(scheduleFieldMarkup).join("")}</div><button type="button" class="quiet" onclick="addScheduleField(this)">＋ 세부 항목</button><button onclick="saveAppointment('${item?.id || ""}')">${editing ? "변경 사항 공유하기" : "약속 공유하기"}</button></div>`;
}
function editAppointment(id) {
  const item = (data?.appointments || []).find((appointment) => appointment.id === id);
  if (!item) return alert("이 약속을 찾지 못했어요. 화면을 새로고침한 뒤 다시 시도해주세요.");
  popup(appointmentEditorMarkup(item));
}
function confirmDeleteAppointment(id) {
  const item = (data?.appointments || []).find((appointment) => appointment.id === id);
  if (!item) return alert("이 약속을 찾지 못했어요. 화면을 새로고침한 뒤 다시 시도해주세요.");
  popup(`<div class="ai-check appointment-delete"><span>일정 삭제</span><h2>‘${esc(item.title)}’ 약속을 삭제할까요?</h2><p>함께 보는 일정에서 사라지며 되돌릴 수 없어요.</p><div class="popup-actions"><button class="quiet" onclick="closePopup()">취소</button><button class="danger-action" onclick="deleteAppointment('${item.id}')">삭제하기</button></div></div>`);
}
async function deleteAppointment(id) {
  const button = document.querySelector(".appointment-delete .danger-action");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.textContent = "삭제 중…";
  }
  try {
    await api(`/api/appointments/${id}`, { method: "DELETE" });
    data.appointments = (data.appointments || []).filter((appointment) => appointment.id !== id);
    closePopup();
    if (roomId) openRoom(roomId);
    else home();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "삭제하기";
    }
    alert(error.status === 403 ? "이 일정을 삭제할 권한이 없어요." : "일정을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
async function approveAppointmentChange(id) {
  try {
    const updated=await api(`/api/appointments/${id}/approve`,{method:"POST"});
    const index=(data.appointments||[]).findIndex(item=>item.id===id);
    if (index>=0) data.appointments[index]=updated;
    closePopup();
    if (roomId) openRoom(roomId);
  } catch (error) {
    alert(error.status===409?"이미 동의했거나 변경 제안이 끝났어요.":"변경안에 동의하지 못했어요.");
  }
}
async function saveAppointment(id = "") {
  const title = document.querySelector("#appointmentTitle").value.trim(),
    date = document.querySelector("#appointmentDate").value;
  if (!title || !date) return alert("약속 이름과 날짜·시간을 선택해주세요.");
  const editor = document.querySelector(".appointment-editor");
  if (!editor || editor.inert) return;
  const fields = Array.from(editor.querySelectorAll(".schedule-field"), row=>({
    label:row.children[0].value.trim(), value:row.children[1].value.trim()
  })).filter(field=>field.label || field.value);
  if (fields.some(field=>!field.label)) return alert("항목 이름을 입력해주세요.");
  editor.inert = true;
  try {
    await api(id ? `/api/appointments/${id}` : "/api/appointments", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({
        title,
        fields,
        ...(id ? {} : { room_id: editor.dataset.room || null, client_id: editor.dataset.client, source_message_id:editor.dataset.source || null }),
        date: date.replace("T", " "),
        place: document.querySelector("#appointmentPlace").value.trim(),
      }),
    });
    data = await api(`/api/bootstrap?user_id=${encodeURIComponent(signedInId)}`);
    closePopup();
    if (roomId) openRoom(roomId);
    else home();
  } catch (error) {
    editor.inert = false;
    const message = error.status === 409
      ? "이미 다른 수정 제안이 동의를 기다리고 있어요. 먼저 그 제안을 마무리해주세요."
      : error.status === 403
      ? "이 채팅방의 참여자만 약속을 수정할 수 있어요."
      : error.status === 400
        ? "약속 이름, 날짜와 세부 항목을 다시 확인해주세요."
        : "약속을 저장하지 못했어요. 잠시 후 다시 시도해주세요.";
    alert(message);
  }
}
function openChatMore() {
  popup(`<div class="chat-more-sheet"><span>채팅방 도구</span><h2>무엇을 할까요?</h2><p>모바일에서도 약속, 공동 확인, 회고와 방 설정을 모두 사용할 수 있어요.</p><div><button onclick="closePopup();newAppointment()">◷ 약속 잡기</button><button onclick="closePopup();newAgreement()">✓ 공동 확인 만들기</button><button onclick="closePopup();newReflection()">↻ 회고 카드</button><button onclick="closePopup();roomSettings()">⚙ 채팅방 설정</button></div><button class="quiet" onclick="closePopup()">닫기</button></div>`);
}
function newReflection() {
  popup(
    `<h2>약속 회고 카드</h2><p>회의나 공동 확인이 끝난 뒤, 다음 대화를 더 좋게 만들 수 있어요.</p><input id="reflection-title" placeholder="무엇을 함께 돌아볼까요?"><input id="reflection-keep" placeholder="계속할 점을 입력해주세요"><input id="reflection-next" placeholder="다음에는 어떻게 할지 입력해주세요"><button onclick="saveReflection()">회고 카드 남기기</button>`,
  );
}
async function saveReflection() {
  const title = document.querySelector("#reflection-title").value.trim();
  if (!title) return alert("돌아볼 내용을 입력해주세요.");
  try {
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
  } catch {
    alert("회고 카드를 저장하지 못했어요. 이 방의 참여 상태와 연결을 확인해주세요.");
  }
}
function confirmDeleteReflection(id) {
  const item=(data.reflections||[]).find(reflection=>reflection.id===id);
  if (!item) return;
  popup(`<div class="ai-check appointment-delete"><span>회고 삭제</span><h2>‘${esc(item.title)}’ 회고를 삭제할까요?</h2><p>작성한 사람만 삭제할 수 있으며 되돌릴 수 없어요.</p><div class="popup-actions"><button class="quiet" onclick="closePopup()">취소</button><button class="danger-action" onclick="deleteReflection('${id}')">삭제하기</button></div></div>`);
}
async function deleteReflection(id) {
  try {
    await api(`/api/reflections/${id}`,{method:"DELETE"});
    data.reflections=(data.reflections||[]).filter(item=>item.id!==id);
    closePopup();
    if (roomId) syncRoomExtras(roomId,currentRoomMessages);
  } catch (error) {
    alert(error.status===403?"이 회고를 작성한 사람만 삭제할 수 있어요.":"회고를 삭제하지 못했어요.");
  }
}
function showAiPolicy() {
  popup(
    `<div class="ai-policy"><span>Re:Tone AI 안내 · 2026.10</span><h2>내 대화를 돕기 위한 AI 사용</h2><p><b>왜 개입하나요?</b><br>강한 욕설·위협 표현, 오해될 수 있는 말투, 출처 확인이 중요한 건강·안전·법·금융·재난·속보성 주장을 알리기 위해서예요.</p><p><b>무엇을 보내나요?</b><br>사전에 없는 문장에 한해, 지금 입력한 메시지 한 개만 AI 점검에 사용해요. 다만 내가 ‘표현 바꾸기’를 누른 경우에만, 더 자연스러운 제안을 위해 같은 채팅방의 최근 대화 일부를 함께 참고해요. 다른 채팅방·전화번호·비밀번호·프로필은 보내지 않아요.</p><p><b>무엇을 하지 않나요?</b><br>사실을 거짓이라고 단정하거나, AI가 대신 전송하거나, 경고만으로 메시지를 막지 않아요. 최종 전송은 항상 내가 선택해요.</p><p><b>내가 조절할 수 있는 것</b><br>AI 끄기, 강한 표현만 확인, 균형 있게 확인, 꼼꼼한 확인을 설정에서 언제든 바꿀 수 있어요.</p><small>AI 점검 결과는 같은 문장을 빠르게 처리하기 위해 보관될 수 있으며, 설정에서 AI를 끄면 이후 점검을 멈춰요.</small><button onclick="closePopup()">확인했어요</button></div>`,
  );
}
function start() {
  if (signedIn && !signedInId) {
    ["retone-v2-name", "retone-v2-user-id", "retone-v2-session", "retone-v2-ai-level"].forEach((key) => sessionStorage.removeItem(key));
    signedIn = "";
    signedInId = "";
    sessionToken = "";
  }
  // The administrator is not a database chat user. Restoring it through home()
  // would request a bootstrap for the synthetic "admin" id and hide the admin UI.
  if (signedIn && isAdmin) return settings();
  if (signedIn) return home();
  app.innerHTML = `<main class="auth"><section class="auth-showcase"><div class="showcase-brand">Re:<i>Tone</i></div><div class="showcase-copy"><span>TEAM COMMUNICATION, RE:IMAGINED</span><h1>말하기 전에 한 번,<br><em>이해한 뒤에 한 번.</em></h1><p>대화의 온도를 함께 살피고,<br>팀의 중요한 약속을 놓치지 않도록 도와줘요.</p></div><div class="showcase-preview"><div><b>프로젝트 팀 채팅</b><small>AI가 필요한 순간에만 조심스럽게 도와요</small></div><p>“이 부분은 이렇게 정리해 보면 더 잘 전달될 것 같아요.”</p><span>Re:Tone의 제안 · 선택은 언제나 내가</span></div></section><section class="auth-panel"><section class="auth-card"><div class="auth-brand">Re:<i>Tone</i></div><p class="auth-copy">대화와 약속을 더 편안하게 이어가요.</p><div class="auth-tabs"><button class="selected" onclick="authForm('login')">로그인</button><button onclick="authForm('signup')">회원가입</button></div><div id="auth-form"><label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" maxlength="13" autocomplete="tel" oninput="formatPhoneInput(this)" placeholder="010-1234-5678"></label><label>비밀번호${passwordField("auth-password", "비밀번호를 입력하세요", "autocomplete=\"current-password\"")}</label><button class="auth-submit" onclick="finishAuth('login')">로그인</button><button type="button" class="admin-login-link" onclick="authForm('admin')">관리자 로그인</button></div><small>더 나은 대화와 함께하는 작업 공간</small></section></section></main>`;
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
        passwordConfirm: "",
        sensitivity: 50,
        ai: "standard",
        consent: false,
      };
    renderSignupWizard();
    return;
  }
  if (mode === "admin") {
    document.querySelector("#auth-form").innerHTML =
      `<div class="admin-auth"><span>관리자 전용</span><h2>관리자 로그인</h2><p>비밀번호와 2차 인증 코드를 모두 입력해주세요.</p><label>관리자 비밀번호${passwordField("admin-password", "관리자 비밀번호를 입력해주세요", "autocomplete=\"current-password\"")}</label><label>2차 인증 코드${passwordField("admin-two-factor", "2차 인증 코드를 입력해주세요", "inputmode=\"numeric\"")}</label><button class="auth-submit" onclick="finishAdminLogin()">관리자 로그인</button><button type="button" class="admin-back" onclick="authForm('login')">일반 로그인으로 돌아가기</button></div>`;
    return;
  }
  if (join && !signupAiDetails) signupAiDetails = { ...aiDetails() };
  const signupCard = (name) => {
    const [, desc, options] = aiCategories.find(([title]) => title === name);
    return `<article class="signup-ai-category"><b>${name}</b><small>${desc}</small><div>${options.map((option) => `<button type="button" class="${signupAiDetails[name] === option ? "selected" : ""}" onclick="setSignupAiDetail(this,'${name}','${option}')">${option}</button>`).join("")}</div></article>`;
  };
  const categorySetup = `<details class="auth-ai-details" open><summary>항목별 AI 민감도 설정</summary><p>각 항목에서 AI가 어느 정도까지 도울지 정해요. 가입 후에도 바꿀 수 있어요.</p>${aiGroups.map(([title, , names]) => `<section class="signup-ai-group"><b>${title}</b>${names.map(signupCard).join("")}</section>`).join("")}</details>`;
  document.querySelector("#auth-form").innerHTML =
    `<label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" maxlength="13" autocomplete="tel" oninput="formatPhoneInput(this)" placeholder="010-1234-5678"></label><label>비밀번호${passwordField("auth-password", "비밀번호를 입력하세요", "autocomplete=\"current-password\"")}</label>${join ? `<label>AI 개입 정도<select id="auth-ai-level"><option value="light">가볍게 · 강한 욕설만</option><option value="standard" selected>균형 있게 · 말투와 중요한 정보</option><option value="careful">꼼꼼하게 · 더 세심한 확인</option><option value="off">AI 끄기</option></select></label>${categorySetup}<button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI가 개입하는 이유와 사용 범위 보기</button><label class="consent"><input id="auth-ai-consent" type="checkbox"> AI 사용 안내를 읽었고, 선택한 범위의 점검에 동의해요.</label><p class="auth-hint">동의하지 않아도 AI 끄기를 선택해 가입할 수 있고, 설정에서 언제든 변경할 수 있어요.</p>` : ""}<button class="auth-submit" onclick="finishAuth('${mode}')">${join ? "회원가입하고 시작하기" : "로그인"}</button>${join ? '<p class="auth-hint">같은 전화번호가 있으면 확인 절차가 안내돼요.</p>' : '<button type="button" class="admin-login-link" onclick="authForm(\'admin\')">관리자 로그인</button>'}`;
}
function renderSignupWizard() {
  const draft = signupDraft;
  const steps = ["계정", "AI 민감도", "확인"];
  const progress = `<div class="signup-progress"><span>${draft.step + 1} / ${steps.length}</span><b>${steps[draft.step]}</b><div><i style="width:${((draft.step + 1) / steps.length) * 100}%"></i></div></div>`;
  let content = "";
  if (draft.step === 0)
    content = `<h2>먼저 계정을 만들어요</h2><p>친구들과 안전하게 대화하기 위한 기본 정보예요.</p><label>이름<input id="signup-name" value="${escAttr(draft.name)}" placeholder="이름을 입력해주세요"></label><label>전화번호<input id="signup-phone" value="${escAttr(formatPhoneNumber(draft.phone))}" inputmode="numeric" maxlength="13" autocomplete="tel" oninput="checkSignupPhone()" placeholder="010-1234-5678"><small id="signup-phone-status" class="field-status">010-1234-5678 형식으로 입력해주세요.</small></label><label>비밀번호${passwordField("signup-password", "비밀번호를 입력해주세요", `value="${escAttr(draft.password)}" autocomplete="new-password" oninput="checkPasswordRequirements()"`)}</label><label>비밀번호 다시 입력${passwordField("signup-password-confirm", "비밀번호를 한 번 더 입력해주세요", `value="${escAttr(draft.passwordConfirm || "")}" autocomplete="new-password" oninput="checkPasswordRequirements()"`)}</label><ul class="password-requirements"><li id="password-length">○ 6자 이상</li><li id="password-letter">○ 영어 1자 이상</li><li id="password-special">○ 특수문자 1자 이상</li><li id="password-match">○ 비밀번호를 다시 입력해주세요</li></ul>`;
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
function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}
function isValidMobilePhone(value) {
  return /^010\d{8}$/.test(phoneDigits(value));
}
function formatPhoneNumber(value) {
  const digits = phoneDigits(value);
  if (!digits.startsWith("010")) return digits;
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `010-${digits.slice(3)}`;
  return `010-${digits.slice(3, 7)}-${digits.slice(7)}`;
}
function formatPhoneInput(input) {
  if (input) input.value = formatPhoneNumber(input.value);
}
function checkSignupPhone() {
  const input = document.querySelector("#signup-phone");
  if (!input) return;
  formatPhoneInput(input);
  const phone = phoneDigits(input.value);
  clearTimeout(signupPhoneTimer);
  if (!isValidMobilePhone(phone))
    return setFieldStatus(
      "#signup-phone-status",
      phone.length && !phone.startsWith("010")
        ? "010으로 시작하는 휴대폰 번호를 입력해주세요."
        : "010-1234-5678 형식으로 입력해주세요.",
    );
  setFieldStatus("#signup-phone-status", "확인 중…", "checking");
  signupPhoneTimer = setTimeout(async () => {
    try {
      const out = await api(
        `/api/auth/phone-available?phone=${encodeURIComponent(phone)}`,
      );
      if (phoneDigits(document.querySelector("#signup-phone")?.value) !== phone) return;
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
  const confirmation = document.querySelector("#signup-password-confirm")?.value || "";
  const tests = [
    ["#password-length", value.length >= 6],
    ["#password-letter", /[A-Za-z]/.test(value)],
    ["#password-special", /[^A-Za-z0-9]/.test(value)],
    ["#password-match", Boolean(confirmation) && value === confirmation],
  ];
  tests.forEach(([selector, passed]) => {
    const item = document.querySelector(selector);
    if (item) {
      item.classList.toggle("passed", passed);
      const label = item.id === "password-length"
        ? "6자 이상"
        : item.id === "password-letter"
          ? "영어 1자 이상"
          : item.id === "password-special"
            ? "특수문자 1자 이상"
            : confirmation
              ? passed ? "비밀번호가 일치해요" : "비밀번호가 달라요"
              : "비밀번호를 다시 입력해주세요";
      item.textContent = `${passed ? "✓" : "○"} ${label}`;
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
      phone = phoneDigits(document.querySelector("#signup-phone").value),
      password = document.querySelector("#signup-password").value,
      passwordConfirm = document.querySelector("#signup-password-confirm").value;
    if (password !== passwordConfirm)
      return alert("비밀번호가 서로 달라요. 다시 확인해주세요.");
    if (!name || !isValidMobilePhone(phone) || !checkPasswordRequirements())
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
    Object.assign(signupDraft, { name, phone, password, passwordConfirm });
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
    rememberAvatar(user);
    sessionToken = "";
    signedIn = user.name;
    signedInId = user.id;
    aiIntervention = user.ai_intervention || "standard";
    sessionStorage.removeItem("retone-v2-session");
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
  } catch (error) {
    if (error?.status === 403) {
      alert(
        "관리자 접근이 허용되지 않았어요. 관리자 계정 상태와 서버 설정을 확인해주세요.",
      );
    } else if (error?.status === 401) {
      alert("관리자 비밀번호 또는 2차 인증 코드가 맞지 않아요.");
    } else {
      alert("관리자 로그인을 확인하지 못했어요. 서버가 배포 중인지 잠시 후 다시 시도해주세요.");
    }
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
    rememberAvatar(user);
    sessionToken = "";
    signedIn = user.name;
    signedInId = user.id;
    aiIntervention = user.ai_intervention || "standard";
    sessionStorage.removeItem("retone-v2-session");
    sessionStorage.setItem("retone-v2-name", user.name);
    sessionStorage.setItem("retone-v2-user-id", user.id);
    sessionStorage.setItem("retone-v2-ai-level", aiIntervention);
    sessionStorage.setItem(
      "retone-v2-ai-consent",
      consent || aiIntervention === "off" ? "yes" : "",
    );
    home();
  } catch (error) {
    if (error.status === 429) return alert("로그인에 5번 실패했어요. 15분 뒤 다시 시도해 주세요.");
    alert(
      mode === "signup"
        ? "이미 가입된 전화번호이거나 입력값을 확인해 주세요."
        : "이름, 전화번호 또는 비밀번호를 다시 확인해 주세요.",
    );
  }
}
async function restoreLogin() {
  if (isAdmin) return start();
  try {
    const headers = sessionToken ? {Authorization: `Bearer ${sessionToken}`} : {};
    const user = await api("/api/auth/me", {headers});
    rememberAvatar(user);
    signedIn = user.name;
    signedInId = user.id;
    aiIntervention = user.ai_intervention;
    sessionStorage.setItem("retone-v2-name",user.name);
    sessionStorage.setItem("retone-v2-user-id",user.id);
    sessionStorage.setItem("retone-v2-ai-level",aiIntervention);
  } catch (err) {
    if (err.status !== 401) {
      app.innerHTML = '<section class="auth-card"><p>로그인 상태를 확인하지 못했어요.</p><button onclick="restoreLogin()">다시 연결</button></section>';
      return;
    }
    signedIn = signedInId = "";
    sessionStorage.removeItem("retone-v2-name");
    sessionStorage.removeItem("retone-v2-user-id");
  }
  sessionToken = "";
  sessionStorage.removeItem("retone-v2-session");
  start();
}
restoreLogin();
