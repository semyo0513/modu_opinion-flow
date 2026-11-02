/**
 * participant-app.js
 * 참여자(연수생) 스마트폰 및 웹 브라우저 응답 제출 로직 (다중 질문 & 선택형 투표 지원)
 */

import { pollService } from './firebase-service.js';

let activeRoomCode = null;
let currentRoomData = null;
let activeQuestionIndex = -1;
let activeQuestion = null;
let selectedChoiceIndex = null;

// DOM 캐시
const screenEnter = document.getElementById('screen-enter');
const screenForm = document.getElementById('screen-form');
const screenSuccess = document.getElementById('screen-success');

const inputRoomCode = document.getElementById('input-room-code');
const btnJoin = document.getElementById('btn-join');

const badgeQuestionStep = document.getElementById('badge-question-step');
const badgeQuestionType = document.getElementById('badge-question-type');
const currentQuestionEl = document.getElementById('current-question-text');
const formResponse = document.getElementById('form-response');
const inputNickname = document.getElementById('input-nickname');

const containerTextInput = document.getElementById('container-text-input');
const textResponse = document.getElementById('text-response');
const charCounter = document.getElementById('char-counter');

const containerChoiceInput = document.getElementById('container-choice-input');
const optionsButtonList = document.getElementById('options-button-list');

const btnSubmit = document.getElementById('btn-submit');
const btnSubmitAnother = document.getElementById('btn-submit-another');

window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  pollService.updateSyncStatusUI(pollService.isFirebaseReady, pollService.lastError);
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
    if (activeQuestion) {
      // 해당 질문에 대한 제출 기록 해제 후 다시 폼 열기
      localStorage.removeItem(`op_submitted_${activeRoomCode}_${activeQuestion.id}`);
      showScreen('form');
    }
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

    currentRoomData = data;
    handleRoomDataChange(data);
  });
}

/**
 * 방 데이터 변경(질문 인덱스 변경 등) 처리
 */
function handleRoomDataChange(data) {
  const questions = data.questions || [];
  
  // 구버전 방 호환성 처리 (questions 배열 대신 meta.question만 있는 경우)
  if (questions.length === 0 && data.meta?.question) {
    questions.push({
      id: 'legacy_q',
      type: 'text',
      title: data.meta.question,
      options: []
    });
  }

  const qIndex = data.meta?.currentQuestionIndex || 0;
  const safeIndex = Math.min(Math.max(qIndex, 0), Math.max(questions.length - 1, 0));
  const newQuestion = questions[safeIndex] || null;

  document.getElementById('badge-room-code').textContent = activeRoomCode;

  if (!newQuestion) {
    currentQuestionEl.textContent = '등록된 질문이 없습니다.';
    return;
  }

  // 질문이 변경되었거나 초기 로드일 때
  const isQuestionChanged = (!activeQuestion || activeQuestion.id !== newQuestion.id);
  activeQuestionIndex = safeIndex;
  activeQuestion = newQuestion;

  renderQuestion(newQuestion, safeIndex, questions.length);

  // 이 질문에 이미 응답했는지 체크
  const submittedKey = `op_submitted_${activeRoomCode}_${newQuestion.id}`;
  const hasSubmitted = localStorage.getItem(submittedKey);

  if (hasSubmitted) {
    showScreen('success');
  } else {
    // 새 질문으로 넘어가면 자동으로 폼 화면으로 복귀!
    if (isQuestionChanged || screenEnter.classList.contains('hidden') === false) {
      showScreen('form');
    }
  }
}

/**
 * 질문 정보 및 폼 UI 렌더링
 */
function renderQuestion(question, index, total) {
  badgeQuestionStep.textContent = `Q ${index + 1} / ${total}`;
  currentQuestionEl.textContent = question.title;

  selectedChoiceIndex = null;

  if (question.type === 'choice') {
    badgeQuestionType.textContent = '선택형 투표';
    badgeQuestionType.className = 'text-[11px] font-semibold text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-2.5 py-0.5 rounded-full';
    containerTextInput.classList.add('hidden');
    containerChoiceInput.classList.remove('hidden');
    renderChoiceOptions(question.options || []);
  } else {
    badgeQuestionType.textContent = '주관식 서술형';
    badgeQuestionType.className = 'text-[11px] font-semibold text-indigo-400 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-0.5 rounded-full';
    containerChoiceInput.classList.add('hidden');
    containerTextInput.classList.remove('hidden');
    textResponse.value = '';
    charCounter.textContent = '0/500';
  }
}

/**
 * 선택형 투표 보기 옵션 버튼들 생성
 */
function renderChoiceOptions(options) {
  if (!options || options.length === 0) {
    optionsButtonList.innerHTML = `<div class="text-sm text-slate-500">설정된 보기가 없습니다.</div>`;
    return;
  }

  optionsButtonList.innerHTML = options.map((opt, idx) => `
    <button 
      type="button" 
      class="btn-option w-full p-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border-2 border-slate-700/80 hover:border-cyan-500/60 text-left transition-all flex items-center justify-between group"
      data-index="${idx}">
      <span class="flex items-center space-x-3">
        <span class="w-7 h-7 rounded-full bg-slate-800 border border-slate-600 group-hover:border-cyan-400 flex items-center justify-center text-xs font-bold font-mono text-slate-300 group-hover:text-cyan-300">
          ${idx + 1}
        </span>
        <span class="text-slate-100 font-medium text-sm sm:text-base">${escapeHtml(opt)}</span>
      </span>
      <div class="option-radio-dot w-5 h-5 rounded-full border-2 border-slate-600 group-hover:border-cyan-400 flex items-center justify-center"></div>
    </button>
  `).join('');

  optionsButtonList.querySelectorAll('.btn-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      selectOption(idx);
    });
  });
}

function selectOption(index) {
  selectedChoiceIndex = index;
  optionsButtonList.querySelectorAll('.btn-option').forEach(btn => {
    const idx = parseInt(btn.dataset.index, 10);
    const radioDot = btn.querySelector('.option-radio-dot');
    if (idx === index) {
      btn.className = "btn-option w-full p-4 rounded-2xl bg-gradient-to-r from-indigo-950/90 to-cyan-950/90 border-2 border-cyan-400 text-left transition-all flex items-center justify-between shadow-lg shadow-cyan-500/20";
      radioDot.className = "option-radio-dot w-5 h-5 rounded-full border-2 border-cyan-400 bg-cyan-400 shadow-sm flex items-center justify-center";
      radioDot.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-950"></span>`;
    } else {
      btn.className = "btn-option w-full p-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border-2 border-slate-700/80 text-left transition-all flex items-center justify-between";
      radioDot.className = "option-radio-dot w-5 h-5 rounded-full border-2 border-slate-600 flex items-center justify-center";
      radioDot.innerHTML = "";
    }
  });
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!activeQuestion) return;

  const nickname = inputNickname.value.trim();
  let payload = { nickname };

  if (activeQuestion.type === 'choice') {
    if (selectedChoiceIndex === null || selectedChoiceIndex === undefined) {
      alert('보기 중 하나를 선택해주세요.');
      return;
    }
    const selectedText = activeQuestion.options[selectedChoiceIndex];
    payload.choiceIndex = selectedChoiceIndex;
    payload.choiceText = selectedText;
  } else {
    const text = textResponse.value.trim();
    if (!text) {
      alert('의견을 작성해주세요.');
      textResponse.focus();
      return;
    }
    if (text.length > 500) {
      alert('500자 이내로 작성해주세요.');
      return;
    }
    payload.text = text;
  }

  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span class="animate-spin inline-block mr-2">&#9696;</span> 제출 중...`;

  try {
    await pollService.submitResponse(activeRoomCode, activeQuestion.id, payload);
    // 제출 완료 기록
    localStorage.setItem(`op_submitted_${activeRoomCode}_${activeQuestion.id}`, 'true');
    triggerSuccessCelebration();
    showScreen('success');
  } catch (err) {
    alert('제출 중 오류가 발생했습니다: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<span>제출하기</span> <i data-lucide="send" class="w-4 h-4 ml-1"></i>`;
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

function escapeHtml(string) {
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
