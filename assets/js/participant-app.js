/**
 * participant-app.js
 * 참여자(연수생) 스마트폰 및 웹 브라우저 응답 제출 로직
 */

import { pollService } from './firebase-service.js';

let activeRoomCode = null;
let currentQuestionText = '';

const screenEnter = document.getElementById('screen-enter');
const screenForm = document.getElementById('screen-form');
const screenSuccess = document.getElementById('screen-success');

const inputRoomCode = document.getElementById('input-room-code');
const btnJoin = document.getElementById('btn-join');

const currentQuestionEl = document.getElementById('current-question-text');
const formResponse = document.getElementById('form-response');
const inputNickname = document.getElementById('input-nickname');
const textResponse = document.getElementById('text-response');
const charCounter = document.getElementById('char-counter');
const btnSubmit = document.getElementById('btn-submit');
const btnSubmitAnother = document.getElementById('btn-submit-another');

window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkUrlParams();
});

function setupEventListeners() {
  btnJoin?.addEventListener('click', handleManualJoin);
  inputRoomCode?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleManualJoin();
  });

  textResponse?.addEventListener('input', () => {
    const len = textResponse.value.length;
    charCounter.textContent = `${len}/500`;
    if (len > 500) {
      charCounter.classList.add('text-rose-500');
    } else {
      charCounter.classList.remove('text-rose-500');
    }
  });

  formResponse?.addEventListener('submit', handleFormSubmit);
  btnSubmitAnother?.addEventListener('click', () => {
    textResponse.value = '';
    charCounter.textContent = '0/500';
    showScreen('form');
  });
}

function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('room');
  if (code && code.trim().length >= 4) {
    joinRoom(code.trim().toUpperCase());
  } else {
    showScreen('enter');
  }
}

function handleManualJoin() {
  const code = inputRoomCode.value.trim().toUpperCase();
  if (!code) {
    alert('6자리 입장 코드를 입력해주세요.');
    return;
  }
  joinRoom(code);
}

function joinRoom(code) {
  activeRoomCode = code;

  const newUrl = `${window.location.pathname}?room=${code}`;
  window.history.replaceState(null, '', newUrl);

  pollService.subscribeRoom(code, (data) => {
    if (!data || !data.meta) {
      alert('존재하지 않거나 종료된 방 코드입니다. 코드를 다시 확인해주세요.');
      showScreen('enter');
      return;
    }

    currentQuestionText = data.meta.question || '질문이 등록되지 않았습니다.';
    currentQuestionEl.textContent = currentQuestionText;
    document.getElementById('badge-room-code').textContent = code;

    if (screenForm.classList.contains('hidden') && screenSuccess.classList.contains('hidden')) {
      showScreen('form');
    }
  });
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const text = textResponse.value.trim();
  const nickname = inputNickname.value.trim();

  if (!text) {
    alert('의견을 작성해주세요.');
    textResponse.focus();
    return;
  }

  if (text.length > 500) {
    alert('500자 이내로 작성해주세요.');
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span class="animate-spin inline-block mr-2">&#9696;</span> 제출 중...`;

  try {
    await pollService.submitResponse(activeRoomCode, text, nickname);
    triggerSuccessCelebration();
    showScreen('success');
  } catch (err) {
    alert('제출 중 오류가 발생했습니다: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<span>의견 제출하기</span> <i data-lucide="send" class="w-4 h-4 ml-2"></i>`;
    if (window.lucide) window.lucide.createIcons();
  }
}

function triggerSuccessCelebration() {
  if (window.confetti) {
    window.confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

function showScreen(name) {
  screenEnter.classList.add('hidden');
  screenForm.classList.add('hidden');
  screenSuccess.classList.add('hidden');

  if (name === 'enter') screenEnter.classList.remove('hidden');
  if (name === 'form') screenForm.classList.remove('hidden');
  if (name === 'success') screenSuccess.classList.remove('hidden');

  if (window.lucide) window.lucide.createIcons();
}
