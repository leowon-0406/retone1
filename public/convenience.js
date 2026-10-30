// Small quality-of-life features layered on the chat without changing its core flow.
const draftKey=id=>`retoneDraft:${me?.id || 'guest'}:${id}`;
document.addEventListener('input',event=>{
  if(event.target?.id==='text'&&roomId)localStorage.setItem(draftKey(roomId),event.target.value);
});
const originalOpenRoom=openRoom;
openRoom=async function(id){
  await originalOpenRoom(id);
  const composer=document.querySelector('#text');
  const draft=localStorage.getItem(draftKey(id));
  if(composer&&draft){composer.value=draft;composer.focus();}
};
const originalDeliverMessage=deliverMessage;
deliverMessage=async function(){
  const sendingRoom=roomId;
  const delivered=await originalDeliverMessage();
  if(delivered)localStorage.removeItem(draftKey(sendingRoom));
  return delivered;
};
function reactionButtons(message){
  const reactions=Object.entries(message.reactions||{}).map(([emoji,count])=>`<button class="reaction-count" onclick="reactToMessage('${message.id}','${emoji}')">${emoji} ${count}</button>`).join('');
  return `<div class="message-tools">${reactions}<button onclick="reactMenu('${message.id}')">＋ 반응</button><button onclick="copyMessage('${message.id}')">복사</button></div>`;
}
messageView=function(message){
  const pending=message.pending?`<span class="ai-pending"><i></i>${esc(message.status||'AI가 검사하고 있어요')}</span>`:'';
  const unread=message.senderId===me.id&&!message.pending&&message.unreadCount>0?`<span class="read-count" title="아직 읽지 않은 참여자">${message.unreadCount}</span>`:'';
  const tools=!message.pending?reactionButtons(message):'';
  return `<article class="msg ${message.senderId===me.id?'mine':''} ${message.pending?'checking':''}"><div class="meta">${esc(message.sender?.nickname||me.nickname)} · ${message.pending?'방금':new Date(message.createdAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>${esc(message.content)}${unread}${pending}${tools}${message.senderId===me.id&&!message.pending?`<button class="delete" onclick="deleteMessage('${message.id}')">삭제</button>`:''}</article>`;
};
function copyMessage(id){
  const message=roomMessages.find(item=>item.id===id);
  if(!message)return;
  navigator.clipboard?.writeText(message.content).then(()=>toast('메시지를 복사했어요','원하는 곳에 붙여넣을 수 있어요.')).catch(()=>toast('복사할 수 없어요','브라우저 권한을 확인해 주세요.'));
}
function reactMenu(id){
  modal(`<h2>빠른 반응</h2><p class="note">대신 답장하지 않아도 가볍게 마음을 전할 수 있어요.</p><div class="reaction-picker">${['👍','❤️','😂','✅'].map(emoji=>`<button onclick="reactToMessage('${id}','${emoji}')">${emoji}</button>`).join('')}</div><button class="secondary" onclick="closeModal()">닫기</button>`);
}
async function reactToMessage(id,emoji){
  try{await api(`/api/messages/${id}/reaction`,{method:'POST',body:JSON.stringify({userId:me.id,emoji})});closeModal();refresh()}catch(error){toast('반응을 남기지 못했어요',error.error||'잠시 후 다시 시도해 주세요.')}
}
roomMenu=function(){
  const code=roomData.kind==='group'?`<div class="invite-code small-code">${esc(roomData.inviteCode||'코드 없음')}</div><p class="note">친구에게 이 초대 코드를 알려주세요.</p>`:'';
  const notification=`<button class="tool-row" onclick="toggleRoomNotifications()"><span>${roomData.notificationsMuted?'🔕':'🔔'}</span><div><b>이 채팅방 알림 ${roomData.notificationsMuted?'켜기':'끄기'}</b><small>${roomData.notificationsMuted?'새 메시지와 공동 확인 알림을 받지 않고 있어요.':'새 메시지와 공동 확인 알림을 받고 있어요.'}</small></div></button>`;
  const pin=`<button class="tool-row" onclick="toggleRoomPin()"><span>${roomData.pinned?'📌':'○'}</span><div><b>채팅방 ${roomData.pinned?'고정 해제':'상단 고정'}</b><small>${roomData.pinned?'채팅 목록의 일반 순서로 되돌려요.':'자주 쓰는 방을 채팅 목록 맨 위에 둬요.'}</small></div></button>`;
  modal(`<h2>${esc(roomData.name)}</h2>${code}<p class="note">채팅방 관리</p>${pin}${notification}<button class="tool-row" onclick="closeModal();retoneReport()"><span>✦</span><div><b>Re:Tone 대화 점검</b><small>표현과 공동 약속 한눈에 보기</small></div></button>${roomData.kind==='group'?'<button class="primary" style="margin-top:12px" onclick="invite()">친구 초대</button>':''}<button class="primary danger" onclick="leave()">채팅방 나가기</button><button class="secondary" onclick="closeModal()">닫기</button>`);
};
async function toggleRoomPin(){
  try{const pinned=!roomData.pinned;await api(`/api/rooms/${roomId}/pin`,{method:'POST',body:JSON.stringify({userId:me.id,pinned})});roomData.pinned=pinned;closeModal();toast(pinned?'채팅방을 고정했어요':'채팅방 고정을 해제했어요',pinned?'채팅 목록 맨 위에서 볼 수 있어요.':'일반 순서로 돌아갔어요.')}catch(error){toast('고정 설정을 바꾸지 못했어요',error.error||'잠시 후 다시 시도해 주세요.')}
}
