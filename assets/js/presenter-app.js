/**
 * presenter-app.js
 * 강사용 대형 스크린 프리젠테이션 대시보드 로직
 * (다중 질문 순차 제어, 선택형 투표 시각화, 세션 초기화, 질문 관리 및 세션 전환 지원)
 */

import { pollService } from './firebase-service.js';
import { KoreanTextMiner } from './korean-nlp.js';

let currentRoomCode = null;
let roomData = null;
let textMiner = new KoreanTextMiner();
let currentViewMode = 'waiting'; // 'waiting', 'results', 'mining'

let currentQuestions = [];
let currentQuestionIndex = 0;
let currentResponsesList = [];
let currentZoomIndex = -1;
let chartInstance = null;

// 임시 편집 중인 질문 목록 (모달용)
let editingQuestions = [];

// DOM 요소 캐시
const headerSessionTitle = document.getElementById('header-session-title');
const roomCodeDisplay = document.getElementById('room-code-display');
const questionDisplay = document.getElementById('question-display');
const responseCountEl = document.getElementById('response-count');
const qrContainer = document.getElementById('qr-code-box');

const waitingBadgeStep = document.getElementById('waiting-badge-step');
const waitingBadgeType = document.getElementById('waiting-badge-type');
const waitingGuideText = document.getElementById('waiting-guide-text');

const navQuestionStep = document.getElementById('nav-question-step');
const navQuestionType = document.getElementById('nav-question-type');
const btnPrevQuestion = document.getElementById('btn-prev-question');
const btnNextQuestion = document.getElementById('btn-next-question');

// 뷰 패널들
const waitingView = document.getElementById('view-waiting');
const resultsView = document.getElementById('view-results');
const miningView = document.getElementById('view-mining');

const cardsGridContainer = document.getElementById('cards-grid-container');
const choiceResultsContainer = document.getElementById('choice-results-container');
const resultsViewTitle = document.getElementById('results-view-title');
const resultsViewSubtitle = document.getElementById('results-view-subtitle');
const resultsQuestionTypeBadge = document.getElementById('results-question-type-badge');

// 모달 & 드로어
const zoomModal = document.getElementById('zoom-modal');
const zoomCardText = document.getElementById('zoom-card-text');
const zoomCardAuthor = document.getElementById('zoom-card-author');
const zoomCardTime = document.getElementById('zoom-card-time');
const zoomIndexEl = document.getElementById('zoom-card-index');

const drawer = document.getElementById('keyword-drawer');
const drawerKeywordTitle = document.getElementById('drawer-keyword-title');
const drawerCardsList = document.getElementById('drawer-cards-list');

// 질문 관리 모달
const questionsModal = document.getElementById('questions-modal');
const modalQuestionsList = document.getElementById('modal-questions-list');

// 세션 전환 모달
const sessionModal = document.getElementById('session-modal');
const inputSwitchRoomCode = document.getElementById('input-switch-room-code');
const recentSessionsList = document.getElementById('recent-sessions-list');

// 관리자 암호 인증 요소
const adminLockScreen = document.getElementById('admin-lock-screen');
const formAdminAuth = document.getElementById('form-admin-auth');
const inputAdminPassword = document.getElementById('input-admin-password');
const authErrorMsg = document.getElementById('auth-error-msg');
const btnAdminLock = document.getElementById('btn-admin-lock');
const btnOpenPwChange = document.getElementById('btn-open-pw-change');
const pwChangeModal = document.getElementById('pw-change-modal');
const formChangePassword = document.getElementById('form-change-password');

function getAdminPassword() {
  return localStorage.getItem('op_flow_admin_password') || '1234';
}

function checkAdminAuth() {
  const isAuth = sessionStorage.getItem('op_flow_admin_auth') === 'true';
  if (isAuth) {
    adminLockScreen?.classList.add('hidden');
    initRoomFromURL();
  } else {
    adminLockScreen?.classList.remove('hidden');
    inputAdminPassword?.focus();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  pollService.updateSyncStatusUI(pollService.isFirebaseReady, pollService.lastError);
  checkAdminAuth();
});

function setupEventListeners() {
  // 모드 전환 탭 버튼
  document.getElementById('btn-tab-waiting')?.addEventListener('click', () => switchView('waiting'));
  document.getElementById('btn-tab-results')?.addEventListener('click', () => switchView('results'));
  document.getElementById('btn-tab-mining')?.addEventListener('click', () => switchView('mining'));

  // 질문 네비게이션
  btnPrevQuestion?.addEventListener('click', () => changeQuestionIndex(-1));
  btnNextQuestion?.addEventListener('click', () => changeQuestionIndex(1));

  // 결과 공개 토글
  document.getElementById('btn-toggle-reveal')?.addEventListener('click', toggleResultReveal);

  // 세션 응답 초기화 (질문은 유지)
  document.getElementById('btn-reset-session')?.addEventListener('click', handleResetSessionResponses);

  // 세션 관리 / 다른 세션 열기 모달 열기
  document.getElementById('btn-open-session-modal')?.addEventListener('click', openSessionModal);
  document.getElementById('btn-switch-room')?.addEventListener('click', handleSwitchRoomCode);
  document.getElementById('btn-create-new-session')?.addEventListener('click', handleCreateNewSession);

  // 질문 관리 모달 열기
  document.getElementById('btn-manage-questions')?.addEventListener('click', openQuestionsModal);
  document.getElementById('btn-add-question-item')?.addEventListener('click', addNewQuestionItem);
  document.getElementById('btn-load-preset-questions')?.addEventListener('click', loadPresetQuestions);
  document.getElementById('btn-save-questions')?.addEventListener('click', saveQuestionsFromModal);

  // 데모 응답 주입
  document.getElementById('btn-add-sample-data')?.addEventListener('click', injectSampleResponses);

  // CSV 내보내기
  document.getElementById('btn-export-csv')?.addEventListener('click', exportToCSV);

  // 전체화면 토글
  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullScreen);

  // 모달 닫기
  document.getElementById('btn-close-modal')?.addEventListener('click', closeZoomModal);
  document.getElementById('zoom-modal-backdrop')?.addEventListener('click', closeZoomModal);
  document.getElementById('btn-prev-card')?.addEventListener('click', () => navigateZoom(-1));
  document.getElementById('btn-next-card')?.addEventListener('click', () => navigateZoom(1));

  // 드로어 닫기
  document.getElementById('btn-close-drawer')?.addEventListener('click', closeDrawer);

  // 키보드 네비게이션
  window.addEventListener('keydown', (e) => {
    if (zoomModal && !zoomModal.classList.contains('hidden')) {
      if (e.key === 'Escape') closeZoomModal();
      if (e.key === 'ArrowLeft') navigateZoom(-1);
      if (e.key === 'ArrowRight') navigateZoom(1);
    }
  });

  // Firebase 설정 모달
  document.getElementById('btn-open-fb-config')?.addEventListener('click', openFirebaseConfigModal);
  document.getElementById('btn-save-fb-config')?.addEventListener('click', saveFirebaseConfig);
  document.getElementById('btn-close-fb-modal')?.addEventListener('click', closeFirebaseConfigModal);

  // 관리자 인증 & 잠금 이벤트
  formAdminAuth?.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = inputAdminPassword.value;
    if (entered === getAdminPassword()) {
      authErrorMsg?.classList.add('hidden');
      sessionStorage.setItem('op_flow_admin_auth', 'true');
      adminLockScreen?.classList.add('hidden');
      initRoomFromURL();
    } else {
      authErrorMsg?.classList.remove('hidden');
      inputAdminPassword.value = '';
      inputAdminPassword.focus();
    }
  });

  btnAdminLock?.addEventListener('click', () => {
    if (confirm('강사용 화면을 잠그시겠습니까?')) {
      sessionStorage.removeItem('op_flow_admin_auth');
      inputAdminPassword.value = '';
      authErrorMsg?.classList.add('hidden');
      adminLockScreen?.classList.remove('hidden');
      inputAdminPassword.focus();
    }
  });

  btnOpenPwChange?.addEventListener('click', () => {
    pwChangeModal?.classList.remove('hidden');
  });

  formChangePassword?.addEventListener('submit', (e) => {
    e.preventDefault();
    const currPw = document.getElementById('input-curr-pw').value;
    const newPw = document.getElementById('input-new-pw').value;

    if (currPw !== getAdminPassword()) {
      alert('현재 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!newPw || newPw.trim().length < 2) {
      alert('새 비밀번호를 2자 이상 입력해주세요.');
      return;
    }

    localStorage.setItem('op_flow_admin_password', newPw.trim());
    alert('비밀번호가 성공적으로 변경되었습니다!');
    pwChangeModal?.classList.add('hidden');
    document.getElementById('input-curr-pw').value = '';
    document.getElementById('input-new-pw').value = '';
  });
}

/**
 * URL 파라미터에서 방 코드 읽거나 신규 방 생성 유도
 */
async function initRoomFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('room');

  if (code) {
    currentRoomCode = code;
    subscribeToCurrentRoom();
  } else {
    // 기본 방 자동 생성 (질문 3개 기본 프리셋 탑재)
    const initialPreset = [
      {
        id: 'q_' + Date.now() + '_1',
        type: 'text',
        title: '오늘 연수에서 가장 인상 깊었거나 현장에 적용해보고 싶은 점은 무엇인가요?',
        options: []
      },
      {
        id: 'q_' + Date.now() + '_2',
        type: 'choice',
        title: '평소 수업에서 에듀테크 도구를 얼마나 활용하고 계신가요?',
        options: ['거의 활용하지 않음', '가끔 필요할 때 활용함', '주 1~2회 이상 활용함', '거의 매 수업 적극 활용함']
      },
      {
        id: 'q_' + Date.now() + '_3',
        type: 'text',
        title: '에듀테크 활용 시 가장 크게 느끼는 어려움이나 고민은 무엇인가요?',
        options: []
      }
    ];

    currentRoomCode = await pollService.createRoom(initialPreset, "2026 에듀테크 역량강화 직무연수");
    const newUrl = `${window.location.pathname}?room=${currentRoomCode}`;
    window.history.replaceState(null, '', newUrl);
    subscribeToCurrentRoom();
  }
}

/**
 * 방 데이터 실시간 구독
 */
function subscribeToCurrentRoom() {
  if (!currentRoomCode) return;

  roomCodeDisplay.textContent = currentRoomCode;

  const participantUrl = `${window.location.origin}${window.location.pathname.replace('presenter.html', '')}index.html?room=${currentRoomCode}`;
  renderQRCode(participantUrl);
  
  const linkEl = document.getElementById('participant-link-text');
  if (linkEl) linkEl.textContent = participantUrl;

  pollService.subscribeRoom(currentRoomCode, (data) => {
    if (!data) return;
    roomData = data;
    handleDataUpdate();
  });
}

function renderQRCode(url) {
  if (!qrContainer) return;
  qrContainer.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(qrContainer, {
      text: url,
      width: 160,
      height: 160,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }
}

/**
 * 데이터 갱신 시 화면 반영
 */
let prevCount = 0;
function handleDataUpdate() {
  if (!roomData) return;

  if (roomData.meta?.title) {
    headerSessionTitle.textContent = roomData.meta.title;
  }

  // 질문 목록 파싱
  currentQuestions = roomData.questions || [];
  if (currentQuestions.length === 0 && roomData.meta?.question) {
    currentQuestions = [{
      id: 'legacy_q',
      type: 'text',
      title: roomData.meta.question,
      options: []
    }];
  }

  currentQuestionIndex = roomData.meta?.currentQuestionIndex || 0;
  if (currentQuestionIndex >= currentQuestions.length) {
    currentQuestionIndex = Math.max(0, currentQuestions.length - 1);
  }

  const currentQ = currentQuestions[currentQuestionIndex];
  if (!currentQ) return;

  // 질문 UI 업데이트
  const totalQ = currentQuestions.length;
  const stepText = `Q ${currentQuestionIndex + 1} / ${totalQ}`;
  const isChoice = currentQ.type === 'choice';
  const typeText = isChoice ? '선택형 투표' : '주관식 서술형';

  questionDisplay.textContent = currentQ.title;
  waitingBadgeStep.textContent = stepText;
  waitingBadgeType.textContent = typeText;
  navQuestionStep.textContent = stepText;
  navQuestionType.textContent = typeText;

  btnPrevQuestion.disabled = (currentQuestionIndex <= 0);
  btnNextQuestion.disabled = (currentQuestionIndex >= totalQ - 1);

  // 현재 활성 질문에 대한 응답 목록 추출
  let rawResponses = {};
  if (roomData.responses) {
    if (roomData.responses[currentQ.id]) {
      rawResponses = roomData.responses[currentQ.id];
    } else if (currentQuestions.length === 1 && !roomData.responses[currentQ.id] && Object.values(roomData.responses)[0]?.text) {
      // 구버전 flat 구조 호환
      rawResponses = roomData.responses;
    }
  }

  currentResponsesList = Object.values(rawResponses).sort((a, b) => b.createdAt - a.createdAt);
  const currentCount = currentResponsesList.length;

  // 카운트 애니메이션
  if (responseCountEl) {
    responseCountEl.textContent = currentCount;
    if (currentCount > prevCount) {
      responseCountEl.classList.remove('counter-bounce');
      void responseCountEl.offsetWidth;
      responseCountEl.classList.add('counter-bounce');
    }
  }
  prevCount = currentCount;

  updateRevealStatusUI();

  // 뷰 렌더링
  if (currentViewMode === 'results') {
    renderResultsView(currentQ);
  } else if (currentViewMode === 'mining') {
    renderMiningView(currentQ);
  }
}

/**
 * 질문 인덱스 이동 (이전/다음 질문)
 */
async function changeQuestionIndex(delta) {
  const newIndex = currentQuestionIndex + delta;
  if (newIndex >= 0 && newIndex < currentQuestions.length) {
    await pollService.setCurrentQuestionIndex(currentRoomCode, newIndex);
    // 질문을 넘기면 기본 대기 뷰로 전환하여 새 질문 안내
    switchView('waiting');
  }
}

function updateRevealStatusUI() {
  const isRevealed = !!roomData?.meta?.isResultRevealed;
  const btnToggle = document.getElementById('btn-toggle-reveal');
  const badgeReveal = document.getElementById('status-reveal-badge');

  if (btnToggle) {
    btnToggle.innerHTML = isRevealed 
      ? `<i data-lucide="eye-off" class="w-3.5 h-3.5 mr-1 inline"></i> 결과 숨기기` 
      : `<i data-lucide="eye" class="w-3.5 h-3.5 mr-1 inline"></i> 결과 공개`;
  }
  if (badgeReveal) {
    badgeReveal.textContent = isRevealed ? "결과 공개 중" : "비공개 (카운팅 중)";
    badgeReveal.className = isRevealed 
      ? "px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
      : "px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30";
  }
  if (window.lucide) window.lucide.createIcons();
}

async function toggleResultReveal() {
  if (!currentRoomCode || !roomData) return;
  const current = !!roomData?.meta?.isResultRevealed;
  await pollService.setRevealStatus(currentRoomCode, !current);
  if (!current && currentViewMode === 'waiting') {
    switchView('results');
  }
}

/**
 * 뷰 전환 제어
 */
function switchView(mode) {
  currentViewMode = mode;
  [waitingView, resultsView, miningView].forEach(v => v?.classList.add('hidden'));

  const tabs = {
    waiting: document.getElementById('btn-tab-waiting'),
    results: document.getElementById('btn-tab-results'),
    mining: document.getElementById('btn-tab-mining'),
  };

  Object.entries(tabs).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === mode) {
      btn.className = "px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 transition-all flex items-center";
    } else {
      btn.className = "px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex items-center";
    }
  });

  const currentQ = currentQuestions[currentQuestionIndex];

  if (mode === 'waiting') {
    waitingView?.classList.remove('hidden');
  } else if (mode === 'results') {
    resultsView?.classList.remove('hidden');
    if (currentQ) renderResultsView(currentQ);
  } else if (mode === 'mining') {
    miningView?.classList.remove('hidden');
    if (currentQ) renderMiningView(currentQ);
  }

  if (window.lucide) window.lucide.createIcons();
}

/**
 * 결과 보기 렌더링 (주관식 / 선택형 분기)
 */
function renderResultsView(currentQ) {
  if (!currentQ) return;

  if (currentQ.type === 'choice') {
    // 선택형 투표 결과 차트
    resultsViewTitle.textContent = "투표 집계 결과";
    resultsViewSubtitle.textContent = "참여자들이 선택한 실시간 득표율 및 득표수입니다.";
    resultsQuestionTypeBadge.textContent = "선택형 투표";
    resultsQuestionTypeBadge.className = "ml-3 text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30";

    cardsGridContainer.classList.add('hidden');
    choiceResultsContainer.classList.remove('hidden');
    renderChoiceResults(currentQ);
  } else {
    // 주관식 서술형 카드 그리드
    resultsViewTitle.textContent = "참여자 의견 카드";
    resultsViewSubtitle.textContent = "카드를 클릭하면 화면 중앙에 크게 확대되어 상세 내용을 공유할 수 있습니다.";
    resultsQuestionTypeBadge.textContent = "주관식 서술형";
    resultsQuestionTypeBadge.className = "ml-3 text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30";

    choiceResultsContainer.classList.add('hidden');
    cardsGridContainer.classList.remove('hidden');
    renderCardsGrid();
  }
}

/**
 * 선택형 투표 결과 시각화 (Mentimeter 스타일 실시간 애니메이션 바)
 */
function renderChoiceResults(currentQ) {
  const options = currentQ.options || [];
  const totalVotes = currentResponsesList.length;

  // 보기별 득표수 집계
  const countMap = {};
  options.forEach((_, idx) => countMap[idx] = 0);
  currentResponsesList.forEach(r => {
    if (r.choiceIndex !== undefined && countMap[r.choiceIndex] !== undefined) {
      countMap[r.choiceIndex]++;
    }
  });

  // 최고 득표수 찾기
  let maxVotes = 0;
  Object.values(countMap).forEach(v => {
    if (v > maxVotes) maxVotes = v;
  });

  choiceResultsContainer.innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-700/80 pb-4 mb-6">
      <div class="text-sm font-semibold text-slate-300">
        총 투표 참여: <span class="text-cyan-400 font-bold text-lg font-mono">${totalVotes}</span>명
      </div>
      <div class="text-xs text-slate-400">
        최다 득표 항목에 하이라이트 배지가 표시됩니다.
      </div>
    </div>
    <div class="space-y-5">
      ${options.map((optText, idx) => {
        const votes = countMap[idx] || 0;
        const percent = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
        const isLeading = maxVotes > 0 && votes === maxVotes;

        return `
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-sm sm:text-base">
              <span class="font-bold flex items-center ${isLeading ? 'text-cyan-300' : 'text-slate-200'}">
                <span class="w-6 h-6 rounded-full bg-slate-800 border ${isLeading ? 'border-cyan-400 text-cyan-300' : 'border-slate-600 text-slate-400'} flex items-center justify-center text-xs font-mono mr-2.5">
                  ${idx + 1}
                </span>
                ${escapeHtml(optText)}
                ${isLeading ? '<span class="ml-2 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">1위</span>' : ''}
              </span>
              <div class="text-right">
                <span class="font-black font-mono text-lg ${isLeading ? 'text-cyan-300' : 'text-white'}">${percent}%</span>
                <span class="text-xs text-slate-400 ml-1">(${votes}표)</span>
              </div>
            </div>

            <div class="w-full bg-slate-950/80 h-7 rounded-xl p-1 border border-slate-800 relative overflow-hidden shadow-inner">
              <div class="h-full rounded-lg transition-all duration-700 ease-out flex items-center justify-end pr-2 ${
                isLeading 
                  ? 'bg-gradient-to-r from-indigo-500 via-cyan-400 to-cyan-300 shadow-lg shadow-cyan-500/30' 
                  : 'bg-gradient-to-r from-indigo-900 to-indigo-600'
              }" style="width: ${percent}%;">
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * 주관식 서술형 카드 그리드 렌더링
 */
function renderCardsGrid() {
  if (currentResponsesList.length === 0) {
    cardsGridContainer.innerHTML = `
      <div class="col-span-full py-24 text-center text-slate-400">
        <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-40"></i>
        <p class="text-xl font-medium">아직 제출된 응답이 없습니다.</p>
        <p class="text-sm text-slate-500 mt-1">참여자들에게 화면의 QR 코드나 코드를 안내해주세요.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  cardsGridContainer.innerHTML = currentResponsesList.map((resp, index) => {
    const timeFormatted = new Date(resp.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const likes = resp.likes || 0;

    return `
      <div class="card-enter group relative bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 hover:border-indigo-500/80 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:shadow-indigo-500/10 transition-all duration-300 cursor-pointer flex flex-col justify-between"
           data-index="${index}">
        <div>
          <div class="flex items-center justify-between mb-3 text-xs text-slate-400">
            <span class="font-semibold text-indigo-400 flex items-center">
              <span class="w-2 h-2 rounded-full bg-indigo-500 mr-2 animate-pulse"></span>
              ${resp.nickname}
            </span>
            <span>${timeFormatted}</span>
          </div>
          <p class="text-slate-100 text-base leading-relaxed line-clamp-4 font-normal">
            ${escapeHtml(resp.text || '')}
          </p>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-xs text-slate-400">
          <button class="btn-like flex items-center space-x-1 text-slate-400 hover:text-rose-400 transition-colors" data-id="${resp.id}">
            <i data-lucide="heart" class="w-4 h-4 ${likes > 0 ? 'fill-rose-500 text-rose-500' : ''}"></i>
            <span>${likes}</span>
          </button>
          <span class="text-indigo-400/80 group-hover:text-indigo-300 flex items-center font-medium">
            확대 보기 <i data-lucide="maximize-2" class="w-3.5 h-3.5 ml-1"></i>
          </span>
        </div>
      </div>
    `;
  }).join('');

  cardsGridContainer.querySelectorAll('.card-enter').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('.btn-like')) {
        const respId = e.target.closest('.btn-like').dataset.id;
        const currentQ = currentQuestions[currentQuestionIndex];
        pollService.toggleLike(currentRoomCode, currentQ.id, respId);
        return;
      }
      const idx = parseInt(cardEl.dataset.index, 10);
      openZoomModal(idx);
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Spotlight Zoom 모달 열기
 */
function openZoomModal(index) {
  if (index < 0 || index >= currentResponsesList.length) return;
  currentZoomIndex = index;
  const resp = currentResponsesList[index];

  zoomCardText.textContent = resp.text || '';
  zoomCardAuthor.textContent = resp.nickname;
  zoomCardTime.textContent = new Date(resp.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  zoomIndexEl.textContent = `${index + 1} / ${currentResponsesList.length}`;

  zoomModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (window.lucide) window.lucide.createIcons();
}

function closeZoomModal() {
  zoomModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function navigateZoom(direction) {
  const newIndex = currentZoomIndex + direction;
  if (newIndex >= 0 && newIndex < currentResponsesList.length) {
    openZoomModal(newIndex);
  }
}

/**
 * 텍스트마이닝 뷰 렌더링
 */
function renderMiningView(currentQ) {
  if (currentQ.type === 'choice') {
    const parent = document.getElementById('wordcloud-canvas')?.parentElement;
    if (parent) {
      parent.innerHTML = `
        <div class="text-center p-12 text-slate-400">
          <i data-lucide="help-circle" class="w-12 h-12 mx-auto mb-3 opacity-40"></i>
          <p class="text-lg font-bold text-white mb-1">현재 질문은 '선택형 투표'입니다.</p>
          <p class="text-sm">워드클라우드는 주관식 서술형 질문에서 텍스트를 분석할 때 제공됩니다.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
    return;
  }

  // 캔버스 복구 확인
  let canvas = document.getElementById('wordcloud-canvas');
  if (!canvas) {
    const wrap = document.querySelector('#view-mining .lg\\:col-span-7 .flex-1');
    if (wrap) {
      wrap.innerHTML = `<canvas id="wordcloud-canvas" class="w-full h-full"></canvas>`;
      canvas = document.getElementById('wordcloud-canvas');
    }
  }

  if (currentResponsesList.length === 0) return;

  const analysis = textMiner.analyzeResponses(currentResponsesList);
  renderStopwordsTags();
  renderWordCloud(analysis.frequencies, analysis.keywordMap);
  renderBarChart(analysis.frequencies, analysis.keywordMap);
}

function renderStopwordsTags() {
  const container = document.getElementById('stopwords-tag-container');
  if (!container) return;

  const stopwordsArray = Array.from(textMiner.stopwords).slice(0, 15);
  container.innerHTML = stopwordsArray.map(word => `
    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-700/80 text-slate-300 border border-slate-600">
      ${escapeHtml(word)}
      <button class="ml-1.5 text-slate-400 hover:text-rose-400" onclick="window.removeStopwordItem('${escapeHtml(word)}')">
        &times;
      </button>
    </span>
  `).join('') + `
    <button onclick="window.promptAddStopword()" class="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors">
      + 제외어 추가
    </button>
  `;
}

window.removeStopwordItem = (word) => {
  textMiner.removeStopword(word);
  const currentQ = currentQuestions[currentQuestionIndex];
  if (currentQ) renderMiningView(currentQ);
};

window.promptAddStopword = () => {
  const input = prompt("워드클라우드 및 차트에서 제외할 단어를 입력하세요 (쉼표로 구분 가능):");
  if (!input) return;
  input.split(',').forEach(w => textMiner.addStopword(w.trim()));
  const currentQ = currentQuestions[currentQuestionIndex];
  if (currentQ) renderMiningView(currentQ);
};

function renderWordCloud(frequencies, keywordMap) {
  const canvas = document.getElementById('wordcloud-canvas');
  if (!canvas || !window.WordCloud) return;

  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth || 700;
  canvas.height = 420;

  if (frequencies.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '16px Pretendard';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText('추출된 키워드가 충분하지 않습니다.', canvas.width / 2, canvas.height / 2);
    return;
  }

  const topList = frequencies.slice(0, 60);
  const maxFreq = topList[0][1];
  const minFreq = topList[topList.length - 1][1];

  const formattedList = topList.map(([word, freq]) => {
    const size = maxFreq === minFreq 
      ? 36 
      : 22 + Math.round(((freq - minFreq) / (maxFreq - minFreq)) * 48);
    return [word, size];
  });

  const colors = ['#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#60a5fa'];

  window.WordCloud(canvas, {
    list: formattedList,
    gridSize: 8,
    weightFactor: 1,
    fontFamily: 'Pretendard, sans-serif',
    fontWeight: 'bold',
    color: () => colors[Math.floor(Math.random() * colors.length)],
    rotateRatio: 0.25,
    rotationSteps: 2,
    backgroundColor: 'transparent',
    click: (item) => {
      const keyword = item[0];
      openKeywordDrawer(keyword, keywordMap.get(keyword) || []);
    },
    hover: (item, dimension, event) => {
      canvas.style.cursor = item ? 'pointer' : 'default';
    }
  });
}

function renderBarChart(frequencies, keywordMap) {
  const chartEl = document.getElementById('barchart-canvas');
  if (!chartEl || !window.Chart) return;

  const top15 = frequencies.slice(0, 15);
  const labels = top15.map(item => item[0]);
  const dataValues = top15.map(item => item[1]);

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new window.Chart(chartEl, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '언급 횟수 (건)',
        data: dataValues,
        backgroundColor: 'rgba(99, 102, 241, 0.75)',
        borderColor: 'rgba(129, 140, 248, 1)',
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.raw}건 언급됨 (클릭 시 원문 확인)`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', stepSize: 1 },
          grid: { color: 'rgba(255, 255, 255, 0.06)' }
        },
        y: {
          ticks: { color: '#f1f5f9', font: { size: 13, family: 'Pretendard' } },
          grid: { display: false }
        }
      },
      onClick: (evt, activeElements) => {
        if (activeElements.length > 0) {
          const idx = activeElements[0].index;
          const kw = labels[idx];
          openKeywordDrawer(kw, keywordMap.get(kw) || []);
        }
      }
    }
  });
}

function openKeywordDrawer(keyword, cardIds) {
  drawerKeywordTitle.textContent = `'${keyword}' 언급된 원문 (${cardIds.length}건)`;

  const matchedCards = currentResponsesList.filter(r => cardIds.includes(r.id));
  drawerCardsList.innerHTML = matchedCards.map(c => {
    const highlightedText = escapeHtml(c.text || '').replaceAll(
      keyword,
      `<span class="highlight-term">${keyword}</span>`
    );

    return `
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-sm hover:border-indigo-500 transition-all">
        <div class="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span class="font-semibold text-indigo-400">${c.nickname}</span>
          <span>${new Date(c.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p class="text-slate-100 text-sm leading-relaxed">${highlightedText}</p>
      </div>
    `;
  }).join('');

  drawer.classList.remove('translate-x-full');
}

function closeDrawer() {
  drawer.classList.add('translate-x-full');
}

/**
 * 1) 세션 응답 초기화 (질문은 유지)
 */
async function handleResetSessionResponses() {
  const confirmed = confirm(
    `정말로 현재 세션(${currentRoomCode})의 모든 제출 응답을 초기화하시겠습니까?\n\n` +
    `✔️ 등록해두신 질문 리스트(${currentQuestions.length}개)와 방 코드는 그대로 보존됩니다.\n` +
    `✔️ 연수 강의 전 테스트했던 응답자 수와 결과만 깨끗이 '0명'으로 비워집니다.`
  );

  if (!confirmed) return;

  try {
    await pollService.clearResponses(currentRoomCode);
    alert('세션 응답이 성공적으로 초기화되었습니다! 이제 실제 강연을 시작하실 수 있습니다.');
  } catch (err) {
    alert('초기화 중 오류가 발생했습니다: ' + err.message);
  }
}

/**
 * 2) 다른 세션 열기 / 세션 관리 모달
 */
function openSessionModal() {
  inputSwitchRoomCode.value = '';
  renderRecentSessions();
  sessionModal.classList.remove('hidden');
}

function renderRecentSessions() {
  const recents = pollService.getRecentSessions();
  if (recents.length === 0) {
    recentSessionsList.innerHTML = `<div class="text-xs text-slate-500 py-2">최근 방문한 세션 기록이 없습니다.</div>`;
    return;
  }

  recentSessionsList.innerHTML = recents.map(r => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800 border border-slate-800 transition-all cursor-pointer" onclick="window.switchSessionTo('${r.code}')">
      <div>
        <span class="font-bold font-mono text-sm text-indigo-300 mr-2">${r.code}</span>
        <span class="text-xs text-slate-300">${escapeHtml(r.title)}</span>
      </div>
      <span class="text-[10px] text-slate-500">${new Date(r.time).toLocaleDateString('ko-KR')}</span>
    </div>
  `).join('');
}

window.switchSessionTo = (code) => {
  window.location.search = `?room=${code}`;
};

async function handleSwitchRoomCode() {
  const code = inputSwitchRoomCode.value.trim().toUpperCase();
  if (!code) {
    alert('이동할 6자리 방 코드를 입력해주세요.');
    return;
  }
  const exists = await pollService.getRoom(code);
  if (!exists) {
    alert('존재하지 않는 방 코드입니다. 코드를 다시 확인해주세요.');
    return;
  }
  window.location.search = `?room=${code}`;
}

async function handleCreateNewSession() {
  const title = prompt("새 세션의 이름을 입력하세요:", "새로운 연수 직무강의");
  if (!title || !title.trim()) return;

  const newCode = await pollService.createRoom([], title.trim());
  window.location.search = `?room=${newCode}`;
}

/**
 * 5) 세션별 질문 관리 모달
 */
function openQuestionsModal() {
  editingQuestions = JSON.parse(JSON.stringify(currentQuestions));
  renderModalQuestionsList();
  questionsModal.classList.remove('hidden');
}

function renderModalQuestionsList() {
  if (editingQuestions.length === 0) {
    modalQuestionsList.innerHTML = `
      <div class="text-center py-10 text-slate-500 text-sm">
        등록된 질문이 없습니다. 아래 [+ 새 질문 추가] 버튼을 눌러 질문을 등록해보세요.
      </div>
    `;
    return;
  }

  modalQuestionsList.innerHTML = editingQuestions.map((q, idx) => `
    <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3 relative group">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="w-6 h-6 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center font-mono">
            ${idx + 1}
          </span>
          <select class="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                  onchange="window.updateModalQuestionType(${idx}, this.value)">
            <option value="text" ${q.type === 'text' ? 'selected' : ''}>주관식 서술형</option>
            <option value="choice" ${q.type === 'choice' ? 'selected' : ''}>선택형 투표</option>
          </select>
        </div>

        <div class="flex items-center space-x-1">
          <button title="위로 이동" class="p-1 text-slate-400 hover:text-white disabled:opacity-30" ${idx === 0 ? 'disabled' : ''} onclick="window.moveModalQuestion(${idx}, -1)">
            <i data-lucide="arrow-up" class="w-3.5 h-3.5"></i>
          </button>
          <button title="아래로 이동" class="p-1 text-slate-400 hover:text-white disabled:opacity-30" ${idx === editingQuestions.length - 1 ? 'disabled' : ''} onclick="window.moveModalQuestion(${idx}, 1)">
            <i data-lucide="arrow-down" class="w-3.5 h-3.5"></i>
          </button>
          <button title="질문 삭제" class="p-1 text-rose-400 hover:text-rose-300 ml-2" onclick="window.deleteModalQuestion(${idx})">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>

      <!-- 질문 제목 입력 -->
      <div>
        <input type="text" value="${escapeHtml(q.title)}" placeholder="질문 내용을 입력하세요" 
               class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
               oninput="window.updateModalQuestionTitle(${idx}, this.value)">
      </div>

      <!-- 선택형 투표 보기 목록 -->
      ${q.type === 'choice' ? `
        <div class="pt-2 border-t border-slate-800 space-y-2">
          <div class="flex items-center justify-between text-xs text-cyan-400 font-semibold">
            <span>투표 보기 목록</span>
            <button class="hover:underline text-[11px]" onclick="window.addModalChoiceOption(${idx})">+ 보기 추가</button>
          </div>
          <div class="space-y-1.5">
            ${(q.options || []).map((opt, optIdx) => `
              <div class="flex items-center space-x-2">
                <span class="text-xs font-mono text-slate-500">${optIdx + 1}.</span>
                <input type="text" value="${escapeHtml(opt)}" placeholder="보기 내용 입력" 
                       class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                       oninput="window.updateModalChoiceOption(${idx}, ${optIdx}, this.value)">
                <button class="text-slate-500 hover:text-rose-400 text-xs px-1" onclick="window.removeModalChoiceOption(${idx}, ${optIdx})">&times;</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `).join('');

  if (window.lucide) window.lucide.createIcons();
}

// 질문 모달 헬퍼 함수들
window.updateModalQuestionType = (idx, newType) => {
  editingQuestions[idx].type = newType;
  if (newType === 'choice' && (!editingQuestions[idx].options || editingQuestions[idx].options.length === 0)) {
    editingQuestions[idx].options = ['보기 1', '보기 2', '보기 3'];
  }
  renderModalQuestionsList();
};

window.updateModalQuestionTitle = (idx, val) => {
  editingQuestions[idx].title = val;
};

window.addModalChoiceOption = (idx) => {
  if (!editingQuestions[idx].options) editingQuestions[idx].options = [];
  editingQuestions[idx].options.push(`새 보기 ${editingQuestions[idx].options.length + 1}`);
  renderModalQuestionsList();
};

window.updateModalChoiceOption = (qIdx, optIdx, val) => {
  editingQuestions[qIdx].options[optIdx] = val;
};

window.removeModalChoiceOption = (qIdx, optIdx) => {
  editingQuestions[qIdx].options.splice(optIdx, 1);
  renderModalQuestionsList();
};

window.moveModalQuestion = (idx, delta) => {
  const target = idx + delta;
  if (target < 0 || target >= editingQuestions.length) return;
  const temp = editingQuestions[idx];
  editingQuestions[idx] = editingQuestions[target];
  editingQuestions[target] = temp;
  renderModalQuestionsList();
};

window.deleteModalQuestion = (idx) => {
  if (editingQuestions.length <= 1) {
    alert('최소 1개의 질문은 유지되어야 합니다.');
    return;
  }
  editingQuestions.splice(idx, 1);
  renderModalQuestionsList();
};

function addNewQuestionItem() {
  editingQuestions.push({
    id: 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 3),
    type: 'text',
    title: '새로운 질문을 입력하세요',
    options: []
  });
  renderModalQuestionsList();
}

/**
 * 질문 5종 추천 프리셋 자동 채우기
 */
function loadPresetQuestions() {
  if (!confirm('추천 질문 5종(주관식 3개 + 선택형 투표 2개)으로 목록을 새로 구성할까요?')) return;
  
  editingQuestions = [
    {
      id: 'q_' + Date.now() + '_1',
      type: 'choice',
      title: '평소 학교 현장에서 에듀테크 도구를 얼마나 활용하고 계신가요?',
      options: ['거의 활용하지 않음', '가끔 필요할 때 활용함', '주 1~2회 이상 활용함', '매 수업 적극 활용함']
    },
    {
      id: 'q_' + Date.now() + '_2',
      type: 'text',
      title: '오늘 연수에서 가장 인상 깊었거나 현장에 적용해보고 싶은 점은 무엇인가요?',
      options: []
    },
    {
      id: 'q_' + Date.now() + '_3',
      type: 'choice',
      title: '에듀테크 도구 도입 시 가장 큰 걸림돌은 무엇이라고 생각하시나요?',
      options: ['기기 및 네트워크 인프라 부족', '수업 준비 시간 부족', '학생 기기 관리 및 통제 어려움', '활용법 미숙 및 연수 기회 부족']
    },
    {
      id: 'q_' + Date.now() + '_4',
      type: 'text',
      title: '학생들과 수업 중 실시간 의견수렴 도구를 사용한다면 어떤 수업에 적용하고 싶으신가요?',
      options: []
    },
    {
      id: 'q_' + Date.now() + '_5',
      type: 'text',
      title: '강사나 연수 운영진에게 남기고 싶은 한마디 또는 건의사항은?',
      options: []
    }
  ];
  renderModalQuestionsList();
}

/**
 * 편집한 질문 목록 Firebase에 저장
 */
async function saveQuestionsFromModal() {
  for (const q of editingQuestions) {
    if (!q.title.trim()) {
      alert('모든 질문의 제목을 입력해주세요.');
      return;
    }
  }

  try {
    await pollService.updateQuestions(currentRoomCode, editingQuestions);
    questionsModal.classList.add('hidden');
    alert('세션 질문이 성공적으로 저장되었습니다!');
  } catch (err) {
    alert('저장 중 오류 발생: ' + err.message);
  }
}

/**
 * CSV 다운로드 (UTF-8 BOM 탑재)
 */
function exportToCSV() {
  if (currentResponsesList.length === 0) {
    alert("현재 질문에 내보낼 응답 데이터가 없습니다.");
    return;
  }

  const currentQ = currentQuestions[currentQuestionIndex];
  const isChoice = currentQ?.type === 'choice';

  let csvContent = "\uFEFF";
  if (isChoice) {
    csvContent += "번호,작성자,제출시간,선택항목번호,선택보기내용\n";
    currentResponsesList.forEach((r, idx) => {
      const time = new Date(r.createdAt).toLocaleString('ko-KR');
      csvContent += `${idx + 1},"${r.nickname}","${time}",${(r.choiceIndex ?? 0) + 1},"${r.choiceText || ''}"\n`;
    });
  } else {
    csvContent += "번호,작성자,제출시간,공감수,응답내용\n";
    currentResponsesList.forEach((r, idx) => {
      const time = new Date(r.createdAt).toLocaleString('ko-KR');
      const cleanText = `"${(r.text || '').replace(/"/g, '""')}"`;
      csvContent += `${idx + 1},"${r.nickname}","${time}",${r.likes || 0},${cleanText}\n`;
    });
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `연수응답_${currentRoomCode}_Q${currentQuestionIndex + 1}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 데모용 샘플 데이터 생성
 */
async function injectSampleResponses() {
  const currentQ = currentQuestions[currentQuestionIndex];
  if (!currentQ) return;

  if (currentQ.type === 'choice') {
    const opts = currentQ.options || ['보기1', '보기2'];
    for (let i = 0; i < 8; i++) {
      const choiceIdx = Math.floor(Math.random() * opts.length);
      await pollService.submitResponse(currentRoomCode, currentQ.id, {
        choiceIndex: choiceIdx,
        choiceText: opts[choiceIdx],
        nickname: `연수생_${Math.floor(10 + Math.random() * 90)}`
      });
    }
  } else {
    const samples = [
      "실시간으로 의견이 모이고 워드클라우드로 즉각 시각화되는 방식이 수업 집중도를 크게 높일 수 있을 것 같아요.",
      "학생들이 스마트폰으로 간단하게 의견을 제출하고 즉시 피드백을 받는 구조가 매우 유익합니다.",
      "에듀테크 도구를 학교 수업과 학급 회의에 적극적으로 적용해보고 싶습니다. 실습 중심 연수라 좋았습니다.",
      "워드클라우드에서 특정 키워드를 누르면 원문 카드가 바로 뜨는 기능이 강평할 때 아주 편리할 것 같습니다.",
      "조사나 어미가 잘 분리되어 핵심 단어만 깔끔하게 도출되는 점이 인상 깊습니다.",
      "강의실 스크린에서 카드를 하나씩 크게 확대해서 읽어줄 수 있는 점이 대형 강의에 딱 맞네요."
    ];
    for (const text of samples) {
      await pollService.submitResponse(currentRoomCode, currentQ.id, { text });
    }
  }
}

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function openFirebaseConfigModal() {
  const modal = document.getElementById('fb-config-modal');
  const current = localStorage.getItem('op_flow_firebase_config') || '';
  const textarea = document.getElementById('fb-config-textarea');
  if (textarea) textarea.value = current;
  modal?.classList.remove('hidden');
}

function closeFirebaseConfigModal() {
  document.getElementById('fb-config-modal')?.classList.add('hidden');
}

function saveFirebaseConfig() {
  const textarea = document.getElementById('fb-config-textarea');
  if (!textarea) return;
  try {
    const parsed = JSON.parse(textarea.value.trim());
    pollService.saveConfig(parsed);
    alert('Firebase 설정이 저장되었습니다! 페이지를 새로고침합니다.');
    window.location.reload();
  } catch (err) {
    alert('올바른 JSON 형식이 아닙니다. 형식을 확인해주세요.');
  }
}

function escapeHtml(string) {
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
