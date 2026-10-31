const app = document.querySelector("#app");
let data = null,
  roomId = null,
  nav = "chat";
let signedIn = sessionStorage.getItem("retone-v2-name") || "";
let signedInId = sessionStorage.getItem("retone-v2-user-id") || "";
let aiIntervention = sessionStorage.getItem("retone-v2-ai-level") || "standard";
let pendingSend = null;
let aiPrefetch = { text: "", result: null, promise: null, timer: null };
let aiSavedResults = (() => {
  try {
    return JSON.parse(localStorage.getItem("retone-ai-results-v1") || "{}");
  } catch {
    return {};
  }
})();
const esc = (s) =>
  String(s || "").replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
const aiCacheKey = (text) => `${aiIntervention}|${text.trim().toLowerCase()}`;
function savedAiResult(text) {
  return aiSavedResults[aiCacheKey(text)] || null;
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
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!r.ok) throw new Error();
  return r.json();
}
function rail() {
  return `<aside class="rail"><div class="brand">Re:<i>Tone</i></div><p>더 나은 대화를 위한<br>새로운 작업 공간</p><nav><button class="${nav === "chat" ? "active" : ""}" onclick="nav='chat';home()">채팅</button><button class="${nav === "friends" ? "active" : ""}" onclick="nav='friends';friends()">친구</button><button onclick="settings()">설정</button></nav><small>${esc(signedIn || "Re:Tone")} · v2</small></aside>`;
}
async function home() {
  data = await api("/api/bootstrap");
  roomId = null;
  const rooms = data.rooms.filter(
    (r) => !["science", "friends"].includes(r.id),
  );
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>채팅</h1><button class="new-room" onclick="newRoom()">＋ 새 대화</button></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님, 반가워요.</h2><p>친구를 초대해 첫 대화를 시작해 보세요.</p></div><div class="dash"><section class="focus"><b>오늘의 공동 확인</b><span>채팅방에서 함께 확인할 일을 만들어 보세요.</span></section><section class="focus schedule"><b>다음 약속 <button onclick="newAppointment()">＋</button></b><span>친구들과 약속을 정하면 여기에 보여요.</span></section></div><div class="rooms">${rooms.length ? rooms.map((r) => `<button class="room" onclick="openRoom('${r.id}')"><span class="avatar">${esc(r.name[0])}</span><span class="copy"><b>${r.pinned ? "📌 " : ""}${esc(r.name)}</b><span>${esc(r.last)}</span></span>${r.unread ? `<span class="badge">${r.unread}</span>` : ""}</button>`).join("") : `<button class="empty-chat" onclick="newRoom()"><b>아직 대화가 없어요</b><span>친구를 초대하거나 단체 채팅을 만들어 보세요. ＋</span></button>`}</div></div></section></main>`;
}
async function openRoom(id) {
  roomId = id;
  const room = data.rooms.find((r) => r.id === id),
    messages = await api(`/api/rooms/${id}/messages`);
  app.innerHTML = `<main class="layout">${rail()}<section class="chat"><header class="head"><button onclick="home()">←</button><div><h1>${esc(room.name)}</h1><span>참여자 ${room.members}명 · 연결됨</span></div><button onclick="newAgreement()">✓</button></header><section class="messages" id="messages">${messages.map(view).join("")}${data.agreements
    .slice(0, 1)
    .map(
      (a) =>
        `<article class="agreement"><b>✓ 공동 확인 · ${esc(a.task)}</b><small>담당 ${esc(a.assignee)} · ${esc(a.deadline)}</small></article>`,
    )
    .join(
      "",
    )}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="queueAiCheck(this.value)"><span id="ai-status" class="ai-status"></span><button>↑</button></form></section></main>`;
  document.querySelector("#messages").scrollTop = 999999;
}
async function friends() {
  const users = await api("/api/users");
  const list = users.filter((u) => u.id !== signedInId);
  app.innerHTML = `<main class="layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><button class="new-room" onclick="home()">채팅 목록</button></header><div class="content"><div class="intro"><h2>Re:Tone 친구</h2><p>이 앱에 가입한 친구를 눌러 바로 대화를 시작해요.</p></div><div class="rooms">${list.length ? list.map((u) => `<button class="room" onclick="startDirect('${esc(u.name)}')"><span class="avatar">${esc(u.name[0])}</span><span class="copy"><b>${esc(u.name)}</b><span>눌러서 1:1 대화 시작</span></span><span>›</span></button>`).join("") : `<div class="empty-chat"><b>아직 가입한 친구가 없어요</b><span>친구가 가입하면 이곳에 자동으로 나타나요.</span></div>`}</div></div></section></main>`;
}
function roomSettings() {
  popup(
    `<h2>채팅방 설정</h2><p>대화방 알림과 참여 상태를 관리할 수 있어요.</p><button onclick="localStorage.setItem('retone-muted-'+roomId,'1');closePopup()">이 채팅방 알림 끄기</button><button onclick="if(confirm('채팅방에서 나갈까요?')){closePopup();home()}">채팅방 나가기</button>`,
  );
}
async function startDirect(name) {
  const room = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  data = await api("/api/bootstrap");
  openRoom(room.id);
}
function settings() {
  nav = "settings";
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
function renderDetailedAiSettings(){const root=document.querySelector('.ai-toggles');if(!root)return;const items=[['강한 공격 표현','필요한 경우만'],['비꼼·압박 표현','균형 있게'],['출처 확인 제안','중요한 정보만'],['표현 바꾸기','요청할 때만'],['감정 도움 AI','요청할 때만'],['확인 결과 재사용','균형 있게']];root.innerHTML=items.map(([name,value])=>`<label>${name}<select aria-label="${name} 민감도">${['꺼짐','필요한 경우만','균형 있게','중요한 정보만','요청할 때만','민감하게'].map(option=>`<option ${option===value?'selected':''}>${option}</option>`).join('')}</select></label>`).join('')+`<button class="theme-toggle" onclick="toggleTheme()">${document.body.classList.contains('dark')?'☀️ 라이트 모드':'🌙 다크 모드'}</button>`}function toggleTheme(){document.body.classList.toggle('dark');localStorage.setItem('retone-theme',document.body.classList.contains('dark')?'dark':'light');settings()}if(localStorage.getItem('retone-theme')==='dark')document.body.classList.add('dark');
async function setAiIntervention(level) {
  if (!signedInId) return;
  const user = await api(`/api/users/${signedInId}/preferences`, {
    method: "PATCH",
    body: JSON.stringify({ ai_intervention: level }),
  });
  aiIntervention = user.ai_intervention;
  sessionStorage.setItem("retone-v2-ai-level", aiIntervention);
  settings();
}
function logout() {
  ["retone-v2-name", "retone-v2-user-id", "retone-v2-ai-level"].forEach((k) =>
    sessionStorage.removeItem(k),
  );
  signedIn = "";
  signedInId = "";
  start();
}
function setAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem("retone-avatar", reader.result);
    settings();
  };
  reader.readAsDataURL(file);
}
function view(m) {
  return `<article class="bubble ${m.mine ? "mine" : ""}" ${m.mine ? "" : `onclick="inspectMessage(${JSON.stringify(m.body)})"`}><div class="meta">${esc(m.sender)}</div>${esc(m.body)}${m.mine && m.unread ? `<span class="read">${m.unread}</span>` : ""}${m.mine ? `<button class="delete-message" title="메시지 삭제" onclick="removeMessage('${m.id}')">×</button>` : ""}</article>`;
}
function inspectMessage(text) {
  popup(
    `<div class="ai-check info"><span>상대 메시지</span><h2>이 메시지를 함께 살펴볼까요?</h2><p>Re:Tone은 진실·거짓을 판정하지 않고, 확인에 필요한 단서를 제안해요.</p><button onclick="factCheck(${JSON.stringify(text)})">사실여부 확인 도움받기</button></div>`,
  );
}
async function factCheck(text) {
  const result = await api("/api/ai/check", {
    method: "POST",
    body: JSON.stringify({ text, ai_intervention: "careful" }),
  });
  const info = result.info || {};
  popup(
    `<div class="ai-check info"><span>확인 제안</span><h2>이렇게 확인해 보면 어때요?</h2><p>${esc(info.note || "원문 출처, 게시 날짜, 신뢰할 수 있는 기관의 자료를 함께 확인해 보세요.")}</p><button onclick="closePopup()">확인</button></div>`,
  );
}
function openAiHelp() {
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
  if (aiIntervention === "off" || !text) {
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
    timer: setTimeout(() => runAiCheck(text), 320),
  };
  setAiStatus("AI 확인 준비 중", true);
}
async function runAiCheck(text) {
  if (aiPrefetch.text !== text) return;
  setAiStatus("AI 확인 중", true);
  const request = api("/api/ai/check", {
    method: "POST",
    body: JSON.stringify({ text, ai_intervention: aiIntervention }),
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
  if (aiIntervention === "off")
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
  pendingSend = { body, room: roomId };
  input.value = "";
  input.disabled = true;
  const saved = aiIntervention !== "off" && savedAiResult(body);
  input.placeholder =
    aiIntervention === "off"
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
function showCheckResult(result) {
  if (pendingSend) pendingSend.result = result;
  const info = result.info || { level: "none", queries: [] };
  const suggestion = result.suggestion
    ? `<p class="ai-suggestion">${esc(result.suggestion)}</p>`
    : "";
  if (result.verdict === "WARN") {
    removePendingBubble();
    popup(
      `<div class="ai-check warn"><span>Re:Tone의 제안</span><h2>이렇게 들릴 수도 있어요</h2>${suggestion || "<p>상대에게는 공격적인 표현으로 들릴 수 있어요. 조금 다르게 말해볼까요?</p>"}<small>Re:Tone은 이 문장을 판단하거나 막지 않아요. 선택은 언제나 나에게 있어요.</small><div class="modal-actions"><button class="quiet" onclick="rewritePending()">AI로 표현 바꾸기</button><button onclick="sendApproved()">이대로 보내기</button></div><button class="report-ai" onclick="reportAiResult()">AI 제안이 이상했나요? 문의하기</button></div>`,
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
      body: JSON.stringify({ text: pendingSend.body }),
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
  pendingSend = null;
  closePopup();
  setAiStatus("");
  await api(`/api/rooms/${next.room}/messages`, {
    method: "POST",
    body: JSON.stringify({ sender: "나", body: next.body }),
  });
  openRoom(next.room);
}
function editPendingSend() {
  const body = pendingSend?.body || "";
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
  await api(`/api/rooms/${roomId}/messages/${id}`, { method: "DELETE" });
  openRoom(roomId);
}
function popup(inner) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal" onclick="if(event.target===this)this.remove()"><section>${inner}</section></div>`,
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
    `<div class="modal" onclick="if(event.target===this)this.remove()"><section>${inner}</section></div>`,
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
      assignee: document.querySelector("#assignee").value,
      deadline: document.querySelector("#deadline").value,
    }),
  });
  closePopup();
  openRoom(roomId);
}
function newAppointment() {
  popup(
    `<h2>함께할 약속 잡기</h2><p>회의·보이스톡·만남 일정을 팀에 바로 공유해요.</p><input id="appointmentTitle" placeholder="예: 발표 방향 짧은 회의"><input id="appointmentDate" type="datetime-local"><input id="appointmentPlace" placeholder="장소 또는 채팅방"><button onclick="saveAppointment()">약속 공유하기</button>`,
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
      date: date.replace("T", " "),
      place: document.querySelector("#appointmentPlace").value,
    }),
  });
  closePopup();
  home();
}
function showAiPolicy() {
  popup(
    `<div class="ai-policy"><span>Re:Tone AI 안내 · 2026.10</span><h2>내 대화를 돕기 위한 AI 사용</h2><p><b>왜 개입하나요?</b><br>강한 욕설·위협 표현, 오해될 수 있는 말투, 출처 확인이 중요한 건강·안전·법·금융·재난·속보성 주장을 알리기 위해서예요.</p><p><b>무엇을 보내나요?</b><br>사전에 없는 문장에 한해, 지금 입력한 메시지 한 개만 AI 점검에 사용해요. 다른 채팅방 내용·전화번호·비밀번호·프로필은 보내지 않아요.</p><p><b>무엇을 하지 않나요?</b><br>사실을 거짓이라고 단정하거나, AI가 대신 전송하거나, 경고만으로 메시지를 막지 않아요. 최종 전송은 항상 내가 선택해요.</p><p><b>내가 조절할 수 있는 것</b><br>AI 끄기, 강한 표현만 확인, 균형 있게 확인, 꼼꼼한 확인을 설정에서 언제든 바꿀 수 있어요.</p><small>AI 점검 결과는 같은 문장을 빠르게 처리하기 위해 보관될 수 있으며, 설정에서 AI를 끄면 이후 점검을 멈춰요.</small><button onclick="closePopup()">확인했어요</button></div>`,
  );
}
function start() {
  if (signedIn && !signedInId) {
    sessionStorage.removeItem("retone-v2-name");
    signedIn = "";
  }
  if (signedIn) return home();
  app.innerHTML = `<main class="auth"><section class="auth-card"><div class="auth-brand">Re:<i>Tone</i></div><p class="auth-copy">말하기 전에 한 번,<br>이해한 뒤에 한 번.</p><div class="auth-tabs"><button class="selected" onclick="authForm('login')">로그인</button><button onclick="authForm('signup')">회원가입</button></div><div id="auth-form"></div><small>더 나은 대화와 함께하는 작업 공간</small></section></main>`;
  authForm("login");
}
function authForm(mode) {
  const join = mode === "signup";
  document
    .querySelectorAll(".auth-tabs button")
    .forEach((b, i) => b.classList.toggle("selected", (i === 1) === join));
  document.querySelector("#auth-form").innerHTML =
    `<label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" placeholder="전화번호를 입력하세요"></label><label>비밀번호<input id="auth-password" type="password" placeholder="비밀번호를 입력하세요"></label>${join ? '<label>AI 개입 정도<select id="auth-ai-level"><option value="light">가볍게 · 강한 욕설만</option><option value="standard" selected>균형 있게 · 말투와 중요한 정보</option><option value="careful">꼼꼼하게 · 더 세심한 확인</option><option value="off">AI 끄기</option></select></label><button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI가 개입하는 이유와 사용 범위 보기</button><label class="consent"><input id="auth-ai-consent" type="checkbox"> AI 사용 안내를 읽었고, 선택한 범위의 점검에 동의해요.</label><p class="auth-hint">동의하지 않아도 AI 끄기를 선택해 가입할 수 있고, 설정에서 언제든 변경할 수 있어요.</p>' : ""}<button class="auth-submit" onclick="finishAuth('${mode}')">${join ? "회원가입하고 시작하기" : "로그인"}</button>${join ? '<p class="auth-hint">같은 전화번호가 있으면 확인 절차가 안내돼요.</p>' : ""}`;
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
  try {
    const user = await api(
      "/api/auth/" + (mode === "signup" ? "signup" : "login"),
      {
        method: "POST",
        body: JSON.stringify({ name, phone, password, ai_intervention: ai }),
      },
    );
    signedIn = user.name;
    signedInId = user.id;
    aiIntervention = user.ai_intervention || "standard";
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
