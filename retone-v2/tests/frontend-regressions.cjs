const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');

async function main() {
  const dom = new JSDOM('<main id="app"></main>', {url:'https://retone.test/'});
  const context = vm.createContext({
    window:dom.window, document:dom.window.document,
    sessionStorage:dom.window.sessionStorage, localStorage:dom.window.localStorage,
    setTimeout, clearTimeout, setInterval, clearInterval, crypto,
    fetch:async()=>{ throw new Error('unexpected network request'); },
    Notification:function(){}, FileReader:function(){}, alert(){}, confirm(){return true},
    console, URL, URLSearchParams, FormData:dom.window.FormData,
  });
  let source = fs.readFileSync(new URL('../public/app.js', `file://${__filename}`), 'utf8');
  const roomCss = fs.readFileSync(new URL('../public/room-updates.css', `file://${__filename}`), 'utf8');
  const authCss = fs.readFileSync(new URL('../public/auth.css', `file://${__filename}`), 'utf8');
  source = source.replace(/\nrestoreLogin\(\);\s*$/, '\n');
  vm.runInContext(source, context);

  const result = await vm.runInContext(`(async()=>{
    roomId='room-1'; signedInId='me'; signedIn='나';
    data={rooms:[{id:'room-1',members:2}],appointments:[],agreements:[],reflections:[],insights:[]};
    currentRoomMessages=[{id:'old',room_id:'room-1',mine:false,sender:'친구',body:'기존 메시지',unread:0}];
    view=m=>'<article class="bubble '+(m.mine?'mine':'')+'" data-message-id="'+m.id+'">'+m.body+'<div class="bubble-tools"></div></article>';
    syncRoomExtras=()=>{}; notifyNewMessage=()=>{}; queueFactChecks=()=>{};
    document.body.innerHTML='<section class="chat"><section id="messages" data-room="room-1"><article class="bubble" data-message-id="old">기존 메시지<div class="bubble-tools"></div></article><template id="message-end"></template><div id="typing-status" class="typing-bubble"></div></section><input id="text"></section>';
    const input=document.querySelector('#text'); input.value='작성 중인 초안'; input.focus();
    const old=document.querySelector('[data-message-id=old]');
    reconcileBubbles(document.querySelector('#messages'),[
      currentRoomMessages[0],{id:'new',room_id:'room-1',mine:false,sender:'친구',body:'새 메시지',unread:0}
    ]);
    const draftKept=input.value==='작성 중인 초안' && document.activeElement===input;
    const oldKept=document.querySelector('[data-message-id=old]')===old;
    const newAdded=document.querySelector('[data-message-id=new]')?.textContent.includes('새 메시지');

    const writes=[]; queueAiCheck=()=>{};
    api=async(url,options)=>{writes.push({url,active:JSON.parse(options.body).active})};
    onChatTyping('안녕'); await typingWrites;
    stopTyping(); await typingWrites;
    api=async()=>({typing:['친구'],messages:currentRoomMessages,appointments:[],agreements:[],reflections:[],insights:[]});
    await refreshRoom('room-1');
    const messengerTyping=document.querySelectorAll('#typing-status .typing-dots i').length===3 && document.querySelector('#typing-status')?.textContent.includes('친구님이 입력 중');
    const schedule = appointmentEditorMarkup({id:'plan',date:'2026-11-22 18:00',place:'회의실',title:'회의',fields:[{label:'준비물',value:'발표 자료'}]});
    const scheduleFields = schedule.includes('준비물') && schedule.includes('발표 자료') && schedule.includes('＋ 세부 항목');
    const scheduleCard = viewAppointment({id:'plan',date:'2026-11-22 18:00',place:'회의실',title:'회의',fields:[]});
    const scheduleActions = scheduleCard.includes('함께 수정') && scheduleCard.includes('일정 삭제');
    const localScheduleTime = localDateTimeValue(new Date(2026,10,22,18,5)) === '2026-11-22T18:05';
    const loginPhoneFormat = formatPhoneNumber('01012345678') === '010-1234-5678';
    data.appointments=[];
    const planAlignment = alignmentCard([{id:'align-1',body:'발표 자료는 내가 준비할게',alignment_hint:true,alignment_kind:'plan',alignment_summary:'발표 자료 준비 역할 정하기'}]);
    const planAlignmentVisible = planAlignment.includes('말맞춤 제안 · 계획') && planAlignment.includes('발표 자료 준비 역할 정하기');
    let aiRequestBody=null;
    api=async(url,options)=>{if(url==='/api/ai/check'){aiRequestBody=JSON.parse(options.body);return {verdict:'PASS',source:'quick',info:{level:'none'}}} throw new Error('unexpected')};
    aiPrefetch={text:'오늘 회의 어떻게 할까',result:null,promise:null,timer:null};
    await runAiCheck('오늘 회의 어떻게 할까');
    const quickBeforeSend=aiRequestBody?.phase==='pre_send' && Array.isArray(aiRequestBody.context) && aiRequestBody.context.length>0;
    const manualFlow=conversationPulse().includes('눌러서 분석');
    nav='settings';
    const settingsSelected=rail().includes('class="active" onclick="settings()"');
    document.body.innerHTML='<div class="rooms"><button data-room-id="old"></button><button data-room-id="new"></button></div>';
    updateHomeRoomSummaries([{id:'old',updated:1,last:'old',unread:0},{id:'new',updated:2,last:'new',unread:0}]);
    const newestRoomFirst=document.querySelector('.rooms button')?.dataset.roomId==='new';
    friendIdentityCache={userId:'me',profile:{friend_code:'MZ3C4M',qr_svg:'<svg viewBox="0 0 10 10"></svg>'}};
    openFriendAdd('qr'); await Promise.resolve(); await Promise.resolve();
    const friendCodeVisible = document.querySelector('#friend-code-overview')?.textContent.includes('MZ3C4M');
    const qrVisible = document.querySelector('#my-friend-qr .qr-image svg') !== null;
    const qrCodeParsed = friendCodeFromQr('RETONE-FRIEND:mz3c4m') === 'MZ3C4M';
    showFriendAddPanel('name');
    const exactNameSearchVisible = document.querySelector('#friend-name')?.placeholder.includes('가입할 때 입력한 이름');
    localStorage.removeItem('retone-ai-sensitivity');
    const sensitivity=sensitivityState();
    const strongerAiDefaults=sensitivity.overall===55 && sensitivity.categories['강한 공격 표현']===65 && sensitivity.categories['비꼼·압박 표현']===60;
    document.body.innerHTML='<div class="ai-toggles"></div><div id="settings-app-actions"></div>';
    renderDetailedAiSettings();
    const advanced=document.querySelector('.ai-advanced-settings'); advanced.open=true;
    const group=document.querySelector('.ai-setting-group'); group.open=true;
    const choice=group.querySelector('.ai-choice-row button:last-child');
    saveAiDetail(choice,'강한 공격 표현',choice.textContent);
    const aiPanelStaysOpen=advanced.open && group.open && choice.classList.contains('selected');
    return {draftKept,oldKept,newAdded,writes,scheduleFields,scheduleActions,localScheduleTime,loginPhoneFormat,planAlignmentVisible,friendCodeVisible,qrVisible,qrCodeParsed,exactNameSearchVisible,strongerAiDefaults,aiPanelStaysOpen,quickBeforeSend,manualFlow,settingsSelected,newestRoomFirst,messengerTyping};
  })()`, context);
  assert.equal(result.draftKept, true);
  assert.equal(result.oldKept, true);
  assert.equal(result.newAdded, true);
  assert.deepEqual(Array.from(result.writes, item=>item.active), [true, false]);
  assert.ok(result.writes.every(item=>item.url==='/api/rooms/room-1/typing'));
  assert.equal(result.scheduleFields, true);
  assert.equal(result.scheduleActions, true);
  assert.equal(result.localScheduleTime, true);
  assert.equal(result.loginPhoneFormat, true);
  assert.equal(result.planAlignmentVisible, true);
  assert.equal(result.friendCodeVisible, true);
  assert.equal(result.qrVisible, true);
  assert.equal(result.qrCodeParsed, true);
  assert.equal(result.exactNameSearchVisible, true);
  assert.equal(result.strongerAiDefaults, true);
  assert.equal(result.aiPanelStaysOpen, true);
  assert.equal(result.quickBeforeSend, true);
  assert.equal(result.manualFlow, true);
  assert.equal(result.settingsSelected, true);
  assert.equal(result.newestRoomFirst, true);
  assert.equal(result.messengerTyping, true);
  assert.ok((source.match(/id="auth-phone" inputmode="numeric" maxlength="13" autocomplete="tel" oninput="formatPhoneInput\(this\)" placeholder="010-1234-5678"/g) || []).length >= 2);
  assert.match(roomCss, /#reply-slot:not\(:empty\).*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(roomCss, /@keyframes messengerTyping/);
  assert.match(roomCss, /layout > \.rail[\s\S]*display:\s*flex\s*!important/);
  assert.match(authCss, /label>\.password-field\{margin-top:7px\}/);
  assert.match(authCss, /password-requirements\{grid-template-columns:repeat\(2/);
  assert.match(source, /async function decodeFriendQr/);
  assert.match(source, /jsqr@1\.4\.0/);
  console.log('Frontend regressions passed: reply layout, messenger typing, navigation and recent-room ordering.');
}

main().catch(error=>{ console.error(error); process.exitCode=1; });
