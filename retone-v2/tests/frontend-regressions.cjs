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
  source = source.replace(/\nrestoreLogin\(\);\s*$/, '\n');
  vm.runInContext(source, context);

  const result = await vm.runInContext(`(async()=>{
    roomId='room-1'; signedInId='me'; signedIn='나';
    data={rooms:[{id:'room-1',members:2}],appointments:[],agreements:[],reflections:[],insights:[]};
    currentRoomMessages=[{id:'old',room_id:'room-1',mine:false,sender:'친구',body:'기존 메시지',unread:0}];
    view=m=>'<article class="bubble '+(m.mine?'mine':'')+'" data-message-id="'+m.id+'">'+m.body+'<div class="bubble-tools"></div></article>';
    syncRoomExtras=()=>{}; notifyNewMessage=()=>{}; queueFactChecks=()=>{};
    document.body.innerHTML='<section class="chat"><section id="messages" data-room="room-1"><article class="bubble" data-message-id="old">기존 메시지<div class="bubble-tools"></div></article><template id="message-end"></template></section><input id="text"></section>';
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
    onChatTyping('안녕'); await Promise.resolve(); await Promise.resolve();
    stopTyping(); await Promise.resolve(); await Promise.resolve();
    const schedule = appointmentEditorMarkup({id:'plan',date:'2026-11-22 18:00',place:'회의실',title:'회의',fields:[{label:'준비물',value:'발표 자료'}]});
    const scheduleFields = schedule.includes('준비물') && schedule.includes('발표 자료') && schedule.includes('＋ 세부 항목');
    friendIdentityCache={userId:'me',profile:{friend_code:'MZ3C4M',qr_svg:'<svg viewBox="0 0 10 10"></svg>'}};
    openFriendAdd('qr'); await Promise.resolve(); await Promise.resolve();
    const friendCodeVisible = document.querySelector('#friend-code-overview')?.textContent.includes('MZ3C4M');
    const qrVisible = document.querySelector('#my-friend-qr .qr-image svg') !== null;
    const qrCodeParsed = friendCodeFromQr('RETONE-FRIEND:mz3c4m') === 'MZ3C4M';
    return {draftKept,oldKept,newAdded,writes,scheduleFields,friendCodeVisible,qrVisible,qrCodeParsed};
  })()`, context);
  assert.equal(result.draftKept, true);
  assert.equal(result.oldKept, true);
  assert.equal(result.newAdded, true);
  assert.deepEqual(Array.from(result.writes, item=>item.active), [true, false]);
  assert.ok(result.writes.every(item=>item.url==='/api/rooms/room-1/typing'));
  assert.equal(result.scheduleFields, true);
  assert.equal(result.friendCodeVisible, true);
  assert.equal(result.qrVisible, true);
  assert.equal(result.qrCodeParsed, true);
  console.log('Frontend regressions passed: draft, focus, incremental append, typing, schedule and friend QR/code.');
}

main().catch(error=>{ console.error(error); process.exitCode=1; });
