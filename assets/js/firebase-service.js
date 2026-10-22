/**
 * firebase-service.js
 * Firebase Realtime Database 연동 모듈 및 오프라인 데모(BroadcastChannel) 하이브리드 지원
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js';
import { 
  getDatabase, 
  ref, 
  set, 
  push, 
  onValue, 
  update, 
  get 
} from 'https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js';

const savedConfig = localStorage.getItem('op_flow_firebase_config');
export const DEFAULT_FIREBASE_CONFIG = savedConfig ? JSON.parse(savedConfig) : {
  apiKey: "AIzaSyAz8C96b4LoFyUszkxb-775f2xWmDjRUHk",
  authDomain: "opinion-flow-d228f.firebaseapp.com",
  databaseURL: "https://opinion-flow-d228f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "opinion-flow-d228f",
  storageBucket: "opinion-flow-d228f.firebasestorage.app",
  messagingSenderId: "484960458808",
  appId: "1:484960458808:web:5a399316b430b47e002ecd"
};

class RealtimePollService {
  constructor() {
    this.isFirebaseReady = false;
    this.app = null;
    this.db = null;
    this.channel = new BroadcastChannel('opinion_flow_sync');
    this.initFirebase();
  }

  initFirebase(customConfig = null) {
    const config = customConfig || DEFAULT_FIREBASE_CONFIG;
    if (config && config.apiKey && config.databaseURL) {
      try {
        this.app = initializeApp(config, 'opinion-flow-' + Date.now());
        this.db = getDatabase(this.app);
        this.isFirebaseReady = true;
        console.log('[PollService] Firebase Realtime Database 연결 성공!');
      } catch (err) {
        console.warn('[PollService] Firebase 초기화 실패. 로컬 데모 모드로 작동합니다.', err);
        this.isFirebaseReady = false;
      }
    } else {
      console.log('[PollService] Firebase 설정이 없어 로컬/데모 모드(BroadcastChannel)로 시작합니다.');
      this.isFirebaseReady = false;
    }
  }

  saveConfig(newConfig) {
    localStorage.setItem('op_flow_firebase_config', JSON.stringify(newConfig));
    this.initFirebase(newConfig);
  }

  generateRoomCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async createRoom(question, title = '실시간 연수 의견수렴') {
    const roomCode = this.generateRoomCode();
    const roomData = {
      meta: {
        roomId: roomCode,
        title: title,
        question: question,
        status: 'accepting',
        isResultRevealed: false,
        createdAt: Date.now()
      },
      responses: {}
    };

    if (this.isFirebaseReady) {
      const roomRef = ref(this.db, `rooms/${roomCode}`);
      await set(roomRef, roomData);
    } else {
      localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(roomData));
      this.channel.postMessage({ type: 'ROOM_CREATED', roomCode, roomData });
    }

    return roomCode;
  }

  subscribeRoom(roomCode, callback) {
    if (this.isFirebaseReady) {
      const roomRef = ref(this.db, `rooms/${roomCode}`);
      return onValue(roomRef, (snapshot) => {
        const val = snapshot.val();
        callback(val);
      });
    } else {
      const checkLocal = () => {
        const raw = localStorage.getItem(`op_room_${roomCode}`);
        if (raw) {
          try {
            callback(JSON.parse(raw));
          } catch (e) {}
        }
      };

      checkLocal();

      const onChannelMessage = (e) => {
        if (e.data && e.data.roomCode === roomCode) {
          checkLocal();
        }
      };

      this.channel.addEventListener('message', onChannelMessage);
      window.addEventListener('storage', (e) => {
        if (e.key === `op_room_${roomCode}`) {
          checkLocal();
        }
      });

      return () => {
        this.channel.removeEventListener('message', onChannelMessage);
      };
    }
  }

  async submitResponse(roomCode, text, nickname = '') {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('응답 내용을 입력해주세요.');

    const newResponse = {
      id: 'resp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      text: trimmed,
      nickname: nickname.trim() || `연수생_${Math.floor(10 + Math.random() * 90)}`,
      createdAt: Date.now(),
      likes: 0
    };

    if (this.isFirebaseReady) {
      const responsesRef = ref(this.db, `rooms/${roomCode}/responses`);
      const newRef = push(responsesRef);
      newResponse.id = newRef.key;
      await set(newRef, newResponse);
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (!raw) throw new Error('방을 찾을 수 없습니다.');
      const data = JSON.parse(raw);
      if (!data.responses) data.responses = {};
      data.responses[newResponse.id] = newResponse;
      localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
      this.channel.postMessage({ type: 'RESPONSE_ADDED', roomCode });
    }

    return newResponse;
  }

  async setRevealStatus(roomCode, isRevealed) {
    if (this.isFirebaseReady) {
      const metaRef = ref(this.db, `rooms/${roomCode}/meta`);
      await update(metaRef, { isResultRevealed: isRevealed });
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (raw) {
        const data = JSON.parse(raw);
        data.meta.isResultRevealed = isRevealed;
        localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
        this.channel.postMessage({ type: 'STATUS_CHANGED', roomCode });
      }
    }
  }

  async toggleLike(roomCode, responseId) {
    if (this.isFirebaseReady) {
      const likeRef = ref(this.db, `rooms/${roomCode}/responses/${responseId}/likes`);
      const snapshot = await get(likeRef);
      const current = snapshot.val() || 0;
      await set(likeRef, current + 1);
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.responses && data.responses[responseId]) {
          data.responses[responseId].likes = (data.responses[responseId].likes || 0) + 1;
          localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
          this.channel.postMessage({ type: 'LIKE_ADDED', roomCode });
        }
      }
    }
  }
}

export const pollService = new RealtimePollService();
