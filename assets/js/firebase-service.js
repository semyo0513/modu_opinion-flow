/**
 * firebase-service.js
 * Firebase Realtime Database 연동 모듈 및 다중 질문/선택형 투표/세션 관리 지원
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js';
import { 
  getDatabase, 
  ref, 
  set, 
  push, 
  onValue, 
  update, 
  get,
  remove 
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

  // 최근 방문/생성 세션 관리
  saveRecentSession(roomCode, title) {
    try {
      let recents = JSON.parse(localStorage.getItem('op_flow_recent_rooms') || '[]');
      recents = recents.filter(r => r.code !== roomCode);
      recents.unshift({ code: roomCode, title: title || '실시간 의견수렴', time: Date.now() });
      if (recents.length > 10) recents = recents.slice(0, 10);
      localStorage.setItem('op_flow_recent_rooms', JSON.stringify(recents));
    } catch (e) {}
  }

  getRecentSessions() {
    try {
      return JSON.parse(localStorage.getItem('op_flow_recent_rooms') || '[]');
    } catch (e) {
      return [];
    }
  }

  /**
   * 신규 방 생성 (다중 질문 지원)
   */
  async createRoom(initialQuestions = [], title = '실시간 연수 의견수렴') {
    const roomCode = this.generateRoomCode();
    
    // 기본 질문이 없을 경우 1개의 기본 주관식 질문 생성
    const defaultQuestions = initialQuestions.length > 0 ? initialQuestions : [
      {
        id: 'q_' + Date.now() + '_1',
        type: 'text', // 'text' 또는 'choice'
        title: '오늘 연수에서 가장 인상 깊었거나 현장에 적용해보고 싶은 점은 무엇인가요?',
        options: []
      }
    ];

    const roomData = {
      meta: {
        roomId: roomCode,
        title: title,
        currentQuestionIndex: 0,
        status: 'accepting',
        isResultRevealed: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      questions: defaultQuestions,
      responses: {}
    };

    if (this.isFirebaseReady) {
      const roomRef = ref(this.db, `rooms/${roomCode}`);
      await set(roomRef, roomData);
    } else {
      localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(roomData));
      this.channel.postMessage({ type: 'ROOM_CREATED', roomCode, roomData });
    }

    this.saveRecentSession(roomCode, title);
    return roomCode;
  }

  /**
   * 특정 방 데이터 단건 조회
   */
  async getRoom(roomCode) {
    if (this.isFirebaseReady) {
      const roomRef = ref(this.db, `rooms/${roomCode}`);
      const snap = await get(roomRef);
      return snap.exists() ? snap.val() : null;
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      return raw ? JSON.parse(raw) : null;
    }
  }

  /**
   * 실시간 방 구독
   */
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

  /**
   * 세션 질문 목록 저장/업데이트
   */
  async updateQuestions(roomCode, questions) {
    if (this.isFirebaseReady) {
      const questionsRef = ref(this.db, `rooms/${roomCode}/questions`);
      await set(questionsRef, questions);
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (raw) {
        const data = JSON.parse(raw);
        data.questions = questions;
        localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
        this.channel.postMessage({ type: 'QUESTIONS_UPDATED', roomCode });
      }
    }
  }

  /**
   * 현재 활성 질문 인덱스 변경
   */
  async setCurrentQuestionIndex(roomCode, index) {
    if (this.isFirebaseReady) {
      const metaRef = ref(this.db, `rooms/${roomCode}/meta`);
      await update(metaRef, { 
        currentQuestionIndex: index,
        isResultRevealed: false // 질문 넘길 시 기본 비공개
      });
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (raw) {
        const data = JSON.parse(raw);
        data.meta.currentQuestionIndex = index;
        data.meta.isResultRevealed = false;
        localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
        this.channel.postMessage({ type: 'QUESTION_INDEX_CHANGED', roomCode });
      }
    }
  }

  /**
   * 응답 제출 (주관식 or 선택형 투표 지원)
   */
  async submitResponse(roomCode, questionId, responseData) {
    const newResponse = {
      id: 'resp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      nickname: responseData.nickname?.trim() || `연수생_${Math.floor(10 + Math.random() * 90)}`,
      createdAt: Date.now(),
      likes: 0,
      ...responseData
    };

    if (this.isFirebaseReady) {
      const qRef = ref(this.db, `rooms/${roomCode}/responses/${questionId}`);
      const newRef = push(qRef);
      newResponse.id = newRef.key;
      await set(newRef, newResponse);
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (!raw) throw new Error('방을 찾을 수 없습니다.');
      const data = JSON.parse(raw);
      if (!data.responses) data.responses = {};
      if (!data.responses[questionId]) data.responses[questionId] = {};
      data.responses[questionId][newResponse.id] = newResponse;
      localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
      this.channel.postMessage({ type: 'RESPONSE_ADDED', roomCode });
    }

    return newResponse;
  }

  /**
   * 세션 응답 초기화 (질문은 유지하고 제출된 결과만 깨끗이 삭제)
   * @param {string} roomCode
   * @param {string|null} questionId - 특정 질문만 초기화할 경우 지정, null이면 전체 초기화
   */
  async clearResponses(roomCode, questionId = null) {
    if (this.isFirebaseReady) {
      if (questionId) {
        const targetRef = ref(this.db, `rooms/${roomCode}/responses/${questionId}`);
        await remove(targetRef);
      } else {
        const targetRef = ref(this.db, `rooms/${roomCode}/responses`);
        await set(targetRef, {});
      }
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (raw) {
        const data = JSON.parse(raw);
        if (questionId) {
          if (data.responses && data.responses[questionId]) {
            delete data.responses[questionId];
          }
        } else {
          data.responses = {};
        }
        localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
        this.channel.postMessage({ type: 'RESPONSES_CLEARED', roomCode });
      }
    }
  }

  /**
   * 결과 공개 상태 토글
   */
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

  /**
   * 공감(하트) 토글
   */
  async toggleLike(roomCode, questionId, responseId) {
    if (this.isFirebaseReady) {
      const likeRef = ref(this.db, `rooms/${roomCode}/responses/${questionId}/${responseId}/likes`);
      const snapshot = await get(likeRef);
      const current = snapshot.val() || 0;
      await set(likeRef, current + 1);
    } else {
      const raw = localStorage.getItem(`op_room_${roomCode}`);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.responses?.[questionId]?.[responseId]) {
          data.responses[questionId][responseId].likes = (data.responses[questionId][responseId].likes || 0) + 1;
          localStorage.setItem(`op_room_${roomCode}`, JSON.stringify(data));
          this.channel.postMessage({ type: 'LIKE_ADDED', roomCode });
        }
      }
    }
  }
}

export const pollService = new RealtimePollService();
