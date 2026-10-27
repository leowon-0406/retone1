# Re:Tone

## Render 배포

현재 버전은 Render **Web Service**로 배포할 수 있습니다.

1. 이 폴더를 GitHub 저장소에 올립니다. `data.json`은 절대로 올리지 않습니다.
2. Render에서 **New → Blueprint**를 선택하고 해당 GitHub 저장소를 연결합니다.
3. 저장소의 `render.yaml`을 선택해 `retone-chat` 서비스를 생성합니다.
4. 배포가 끝나면 Render가 만든 `https://...onrender.com` 주소를 친구에게 공유합니다.

Render 무료 서비스는 15분 동안 접속이 없으면 잠들 수 있으며, 현재 `data.json` 저장 방식은 재시작 시 기록이 사라집니다. 대화 기록을 계속 보관하려면 다음 버전에서 Render Postgres를 연결해야 합니다.

Re:Tone 채팅 앱 프로토타입입니다.

## 실행 방법

1. 이 폴더를 VS Code에서 엽니다.
2. 터미널에서 `npm start`를 실행합니다. 또는 Windows에서는 `실행하기.cmd`를 더블클릭합니다.
3. 브라우저에서 `http://localhost:3000`을 엽니다.

## 폴더 구성

- `server.js`: 사용자, 채팅방, 메시지, 초대, 말맞춤을 처리하는 서버
- `public/`: 화면 디자인과 브라우저 동작 코드
- `package.json`: 실행 명령

테스트 데이터는 실행 시 자동으로 생성되는 `data.json`에 저장됩니다. 이 파일은 소스 ZIP에 포함하지 않았습니다.
