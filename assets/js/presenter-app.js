/**
 * presenter-app.js
 * 강사용 대형 스크린 프리젠테이션 대시보드 로직
 */

import { pollService } from './firebase-service.js';
import { KoreanTextMiner } from './korean-nlp.js';

let currentRoomCode = null;
let roomData = null;
let textMiner = new KoreanTextMiner();
let currentViewMode = 'waiting';
let currentResponsesList = [];
let currentZoomIndex = -1;
let chartInstance = null;

const roomCodeDisplay = document.getElementById('room-code-display');
const questionDisplay = document.getElementById('question-display');
const responseCountEl = document.getElementById('response-count');
const qrContainer = document.getElementById('qr-code-box');

const waitingView = document.getElementById('view-waiting');
const cardsView = document.getElementById('view-cards');
const miningView = document.getElementById('view-mining');

const zoomModal = document.getElementById('zoom-modal');
const zoomCardText = document.getElementById('zoom-card-text');
const zoomCardAuthor = document.getElementById('zoom-card-author');
const zoomCardTime = document.getElementById('zoom-card-time');
const zoomIndexEl = document.getElementById('zoom-card-index');

const drawer = document.getElementById('keyword-drawer');
const drawerKeywordTitle = document.getElementById('drawer-keyword-title');
const drawerCardsList = document.getElementById('drawer-cards-list');

window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initRoomFromURL();
});

function setupEventListeners() {
  document.getElementById('btn-tab-waiting')?.addEventListener('click', () => switchView('waiting'));
  document.getElementById('btn-tab-cards')?.addEventListener('click', () => switchView('cards'));
  document.getElementById('btn-tab-mining')?.addEventListener('click', () => switchView('mining'));

  document.getElementById('btn-toggle-reveal')?.addEventListener('click', toggleResultReveal);
  document.getElementById('btn-create-room')?.addEventListener('click', handleCreateRoom);
  document.getElementById('btn-add-sample-data')?.addEventListener('click', injectSampleResponses);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportToCSV);
  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullScreen);

  document.getElementById('btn-close-modal')?.addEventListener('click', closeZoomModal);
  document.getElementById('zoom-modal-backdrop')?.addEventListener('click', closeZoomModal);
  document.getElementById('btn-prev-card')?.addEventListener('click', () => navigateZoom(-1));
  document.getElementById('btn-next-card')?.addEventListener('click', () => navigateZoom(1));

  document.getElementById('btn-close-drawer')?.addEventListener('click', closeDrawer);

  window.addEventListener('keydown', (e) => {
    if (zoomModal && !zoomModal.classList.contains('hidden')) {
      if (e.key === 'Escape') closeZoomModal();
      if (e.key === 'ArrowLeft') navigateZoom(-1);
      if (e.key === 'ArrowRight') navigateZoom(1);
    }
  });

  document.getElementById('btn-open-fb-config')?.addEventListener('click', openFirebaseConfigModal);
  document.getElementById('btn-save-fb-config')?.addEventListener('click', saveFirebaseConfig);
  document.getElementById('btn-close-fb-modal')?.addEventListener('click', closeFirebaseConfigModal);
}

async function initRoomFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('room');

  if (code) {
    currentRoomCode = code;
    subscribeToCurrentRoom();
  } else {
    const defaultQuestion = "오늘 연수에서 가장 인상 깊었거나 현장에 적용해보고 싶은 점은 무엇인가요?";
    currentRoomCode = await pollService.createRoom(defaultQuestion, "2026 에듀테크 역량강화 직무연수");
    const newUrl = `${window.location.pathname}?room=${currentRoomCode}`;
    window.history.replaceState(null, '', newUrl);
    subscribeToCurrentRoom();
  }
}

async function handleCreateRoom() {
  const question = prompt("새로운 연수 질문을 입력하세요:", "이번 차시에서 해결하고 싶은 고민이나 기대되는 점은?");
  if (!question || !question.trim()) return;

  currentRoomCode = await pollService.createRoom(question.trim(), "실시간 의견수렴");
  window.location.search = `?room=${currentRoomCode}`;
}

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
      width: 170,
      height: 170,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }
}

let prevCount = 0;
function handleDataUpdate() {
  if (!roomData) return;

  if (roomData.meta && roomData.meta.question) {
    questionDisplay.textContent = roomData.meta.question;
  }

  const responsesObj = roomData.responses || {};
  currentResponsesList = Object.values(responsesObj).sort((a, b) => b.createdAt - a.createdAt);
  const currentCount = currentResponsesList.length;

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

  if (currentViewMode === 'cards') {
    renderCardsView();
  } else if (currentViewMode === 'mining') {
    renderMiningView();
  }
}

function updateRevealStatusUI() {
  const isRevealed = roomData?.meta?.isResultRevealed;
  const btnToggle = document.getElementById('btn-toggle-reveal');
  const badgeReveal = document.getElementById('status-reveal-badge');

  if (btnToggle) {
    btnToggle.innerHTML = isRevealed 
      ? `<i data-lucide="eye-off" class="w-4 h-4 mr-1.5 inline"></i> 결과 숨기기` 
      : `<i data-lucide="eye" class="w-4 h-4 mr-1.5 inline"></i> 결과 공개하기`;
  }
  if (badgeReveal) {
    badgeReveal.textContent = isRevealed ? "결과 공개 중" : "비공개 (카운팅 중)";
    badgeReveal.className = isRevealed 
      ? "px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
      : "px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30";
  }
  if (window.lucide) window.lucide.createIcons();
}

async function toggleResultReveal() {
  if (!currentRoomCode || !roomData) return;
  const current = !!roomData?.meta?.isResultRevealed;
  await pollService.setRevealStatus(currentRoomCode, !current);
  if (!current && currentViewMode === 'waiting') {
    switchView('cards');
  }
}

function switchView(mode) {
  currentViewMode = mode;
  [waitingView, cardsView, miningView].forEach(v => v?.classList.add('hidden'));

  const tabs = {
    waiting: document.getElementById('btn-tab-waiting'),
    cards: document.getElementById('btn-tab-cards'),
    mining: document.getElementById('btn-tab-mining'),
  };

  Object.entries(tabs).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === mode) {
      btn.className = "px-4 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 transition-all flex items-center";
    } else {
      btn.className = "px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex items-center";
    }
  });

  if (mode === 'waiting') {
    waitingView?.classList.remove('hidden');
  } else if (mode === 'cards') {
    cardsView?.classList.remove('hidden');
    renderCardsView();
  } else if (mode === 'mining') {
    miningView?.classList.remove('hidden');
    renderMiningView();
  }

  if (window.lucide) window.lucide.createIcons();
}

function renderCardsView() {
  const container = document.getElementById('cards-grid-container');
  if (!container) return;

  if (currentResponsesList.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-24 text-center text-slate-400">
        <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-40"></i>
        <p class="text-xl font-medium">아직 제출된 응답이 없습니다.</p>
        <p class="text-sm text-slate-500 mt-1">참여자들에게 화면의 QR 코드나 코드를 안내해주세요.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = currentResponsesList.map((resp, index) => {
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
            ${escapeHtml(resp.text)}
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

  container.querySelectorAll('.card-enter').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('.btn-like')) {
        const respId = e.target.closest('.btn-like').dataset.id;
        pollService.toggleLike(currentRoomCode, respId);
        return;
      }
      const idx = parseInt(cardEl.dataset.index, 10);
      openZoomModal(idx);
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function openZoomModal(index) {
  if (index < 0 || index >= currentResponsesList.length) return;
  currentZoomIndex = index;
  const resp = currentResponsesList[index];

  zoomCardText.textContent = resp.text;
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

function renderMiningView() {
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
  renderMiningView();
};

window.promptAddStopword = () => {
  const input = prompt("워드클라우드 및 차트에서 제외할 단어를 입력하세요 (쉼표로 구분 가능):");
  if (!input) return;
  input.split(',').forEach(w => textMiner.addStopword(w.trim()));
  renderMiningView();
};

function renderWordCloud(frequencies, keywordMap) {
  const canvas = document.getElementById('wordcloud-canvas');
  if (!canvas || !window.WordCloud) return;

  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth || 700;
  canvas.height = 450;

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
    const highlightedText = escapeHtml(c.text).replaceAll(
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

function exportToCSV() {
  if (currentResponsesList.length === 0) {
    alert("내보낼 응답 데이터가 없습니다.");
    return;
  }

  let csvContent = "\uFEFF";
  csvContent += "번호,작성자(닉네임),제출시간,공감수,응답내용\n";

  currentResponsesList.forEach((r, idx) => {
    const time = new Date(r.createdAt).toLocaleString('ko-KR');
    const cleanText = `"${r.text.replace(/"/g, '""')}"`;
    csvContent += `${idx + 1},"${r.nickname}","${time}",${r.likes || 0},${cleanText}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `연수의견수렴_${currentRoomCode}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function injectSampleResponses() {
  const samples = [
    "실시간으로 의견이 모이고 워드클라우드로 즉각 시각화되는 방식이 수업 집중도를 크게 높일 수 있을 것 같아요.",
    "학생들이 스마트폰으로 간단하게 의견을 제출하고 즉시 피드백을 받는 구조가 매우 유익합니다.",
    "에듀테크 도구를 학교 수업과 학급 회의에 적극적으로 적용해보고 싶습니다. 실습 중심 연수라 좋았습니다.",
    "워드클라우드에서 특정 키워드를 누르면 원문 카드가 바로 뜨는 기능이 강평할 때 아주 편리할 것 같습니다.",
    "조사나 어미가 잘 분리되어 핵심 단어만 깔끔하게 도출되는 점이 인상 깊습니다.",
    "강의실 스크린에서 카드를 하나씩 크게 확대해서 읽어줄 수 있는 점이 대형 강의에 딱 맞네요.",
    "비회원으로 QR코드만 찍으면 3초 만에 참여할 수 있어서 수업 시작할 때 버벅거림이 없겠어요."
  ];

  for (const text of samples) {
    await pollService.submitResponse(currentRoomCode, text);
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
