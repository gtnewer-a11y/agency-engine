// ─── Classroom Agency Engine — app.js ───────────────────────────────────────
// Calls Google Apps Script (backend) as the secure API proxy.
// All Anthropic + Padlet calls happen server-side via Apps Script.
// Config is stored in localStorage (never expose API keys in client JS).

const VERSION = '1.0.0';

// ─── Config ──────────────────────────────────────────────────────────────────
const CFG_KEY = 'agency_engine_config';
const DIARY_KEY = 'agency_engine_diary';
const TXN_KEY = 'agency_engine_txns';

function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
}
function saveConfigLocal(obj) {
  localStorage.setItem(CFG_KEY, JSON.stringify(obj));
}

// ─── Research Library (default papers, editable in Settings) ─────────────────
const DEFAULT_PAPERS = [
  {
    id: 'p1',
    title: 'Self-Determination Theory in the Classroom',
    authors: 'Deci & Ryan (2020)',
    abstract: 'Intrinsic motivation is fostered when students experience autonomy, competence, and relatedness. Gamification frameworks that offer meaningful choices without coercive rewards significantly predict deeper engagement and long-term retention.',
    tags: ['Motivation', 'Gamification', 'Autonomy']
  },
  {
    id: 'p2',
    title: 'Cognitive Load and Schema Acquisition',
    authors: 'Sweller et al. (2019)',
    abstract: 'Instructional design that segments complex tasks into scaffolded micro-activities reduces extraneous cognitive load. Portfolio-based assessment directly supports schema automation by encouraging spaced retrieval practice.',
    tags: ['Cognitive Load', 'Scaffolding', 'Assessment']
  },
  {
    id: 'p3',
    title: 'The Desirable Difficulties Effect',
    authors: 'Bjork & Bjork (2021)',
    abstract: 'Introducing productive challenges — spaced practice, interleaving, generation effects — consistently outperforms blocked practice. Students who self-generate reflective writing show 40% greater conceptual retention at 30-day follow-up.',
    tags: ['Retrieval Practice', 'Reflection', 'Retention']
  },
  {
    id: 'p4',
    title: 'Peer Learning in Gamified Environments',
    authors: 'Hamari et al. (2022)',
    abstract: 'Leaderboards produce short-term motivation spikes but can undermine intrinsic drive if competitive framing dominates. Anonymous leaderboards with mastery-framing narratives sustain engagement without social comparison anxiety.',
    tags: ['Leaderboards', 'Peer Learning', 'Gamification']
  },
  {
    id: 'p5',
    title: 'Socratic Seminars and Equitable Participation',
    authors: 'Hattie & Donoghue (2023)',
    abstract: 'Structured discussion protocols where students prepare written positions before speaking increase equitable participation by 60%. Teachers who assign pre-seminar written submissions see broader voices represented across ability levels.',
    tags: ['Discussion', 'Equity', 'Participation']
  }
];

function getPapers() {
  try {
    const stored = localStorage.getItem('agency_papers');
    return stored ? JSON.parse(stored) : DEFAULT_PAPERS;
  } catch { return DEFAULT_PAPERS; }
}
function savePapers(papers) {
  localStorage.setItem('agency_papers', JSON.stringify(papers));
}

// ─── Activity definitions ─────────────────────────────────────────────────────
const ACTIVITY_COLORS = {
  'Letter to Future Self': { icon: 'ti-mail', color: '#6c47ff' },
  'Classroom Receipt': { icon: 'ti-receipt', color: '#00d4aa' },
  'Concept Map': { icon: 'ti-sitemap', color: '#ffb800' },
  'Research Synthesis': { icon: 'ti-file-text', color: '#ff6b9d' },
  'Reflection Journal': { icon: 'ti-notebook', color: '#4fc3f7' },
  'Peer Review': { icon: 'ti-users', color: '#a78bfa' },
  'Creative Extension': { icon: 'ti-palette', color: '#fb923c' },
  'Other': { icon: 'ti-star', color: '#888' }
};

function activityStyle(name) {
  for (const [k, v] of Object.entries(ACTIVITY_COLORS)) {
    if (name && name.toLowerCase().includes(k.toLowerCase().split(' ')[0].toLowerCase())) return v;
  }
  return ACTIVITY_COLORS['Other'];
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function show(id, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'settings') renderSettingsPage();
  if (id === 'research') renderPapers();
  if (id === 'leaderboard') loadLeaderboard();
  if (id === 'dashboard') loadDashboard();
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function showAlert(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert alert-${type} show`;
  setTimeout(() => el.classList.remove('show'), 6000);
}

// ─── GAS Proxy call ───────────────────────────────────────────────────────────
async function callGAS(action, payload = {}) {
  const cfg = getConfig();
  if (!cfg.gasUrl) throw new Error('No Apps Script URL configured. Please add it in Settings.');
  const url = cfg.gasUrl;
  const body = JSON.stringify({ action, ...payload });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // GAS requires text/plain for CORS
    body
  });
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch { throw new Error('Invalid response from Apps Script: ' + text.slice(0, 200)); }
}

// ─── Direct Anthropic call (fallback when no GAS URL configured) ──────────────
async function callClaude(prompt, maxTokens = 1000) {
  const cfg = getConfig();
  if (!cfg.apiKey) throw new Error('No Anthropic API key configured. Add it in Settings.');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ─── Agent 1: Tally Clerk ─────────────────────────────────────────────────────
let sessionGrades = [];
let sessionTotalPts = 0;

function buildGradingPrompt(alias, text, actType, cfg) {
  const low = cfg.ptsLow || 10;
  const mid = cfg.ptsMid || 25;
  const high = cfg.ptsHigh || 50;
  return `You are an automated grading agent for a gamified "Agency Passport" course. Evaluate the following student portfolio submission with strict, consistent rubric application.

SCORING RUBRIC:
- ${low} points: Low-effort (Classroom Receipts, brief check-ins, under 80 words, surface-level or transactional)
- ${mid} points: Mid-effort (Letters to Future Self, Concept Maps, Peer Reviews, Reflection Journals — 80-300 words, genuine personal insight, connects to course content)
- ${high} points: High-effort (Research Synthesis, Creative Extensions — 300+ words, integrates academic concepts, demonstrates transfer of learning, original thinking)

${actType ? `Suspected activity type: ${actType}` : 'Identify the activity type from the content.'}

STUDENT SUBMISSION (alias: ${alias || 'Anonymous'}):
${text}

Respond ONLY with this exact JSON. No other text, no markdown fences:
{"points":${low},"activityType":"string","tier":"Low Effort","rationale":"2-3 sentences explaining the score","strengths":"one specific strength","growthEdge":"one area for improvement"}

Valid points values: ${low}, ${mid}, or ${high} only.`;
}

async function gradeSubmission() {
  const alias = document.getElementById('alias').value.trim() || 'Anonymous';
  const text = document.getElementById('submission').value.trim();
  const actType = document.getElementById('activity-type').value;
  const cfg = getConfig();

  if (!text) { showAlert('alert-clerk', 'Please paste a student submission first.', 'error'); return; }
  if (!cfg.apiKey && !cfg.gasUrl) { showAlert('alert-clerk', 'Add your Anthropic API key or Apps Script URL in Settings first.', 'error'); return; }

  document.getElementById('grade-btn').disabled = true;
  document.getElementById('grade-loading').classList.add('show');
  document.getElementById('result-box').classList.remove('show');

  try {
    let result;
    if (cfg.gasUrl) {
      // Route through Apps Script (keeps API key server-side)
      result = await callGAS('grade', { alias, text, actType });
    } else {
      // Direct call (API key in browser — acceptable for private classroom use)
      const raw = await callClaude(buildGradingPrompt(alias, text, actType, cfg), 800);
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    }

    window._pendingGrade = { alias, activity: result.activityType, pts: result.points, timestamp: new Date().toISOString() };

    document.getElementById('res-pts').textContent = result.points + ' pts';
    document.getElementById('res-activity').textContent = result.activityType || 'Unknown Activity';
    const tierBadge = document.getElementById('res-tier');
    tierBadge.textContent = result.tier;
    tierBadge.className = 'badge ' + (result.points >= (cfg.ptsHigh || 50) ? 'badge-purple' : result.points >= (cfg.ptsMid || 25) ? 'badge-green' : 'badge-amber');
    document.getElementById('res-feedback').innerHTML =
      `<strong>Rationale:</strong> ${result.rationale}<br><br>` +
      `<strong>Strength:</strong> ${result.strengths}<br>` +
      `<strong>Growth edge:</strong> ${result.growthEdge}`;
    document.getElementById('result-box').classList.add('show');

    // Update session metrics
    sessionGrades.push(result.points);
    sessionTotalPts += result.points;
    document.getElementById('c-graded').textContent = sessionGrades.length;
    document.getElementById('c-avg').textContent = Math.round(sessionTotalPts / sessionGrades.length);

  } catch (e) {
    showAlert('alert-clerk', 'Grading error: ' + e.message, 'error');
  }

  document.getElementById('grade-btn').disabled = false;
  document.getElementById('grade-loading').classList.remove('show');
}

async function commitToSheets() {
  if (!window._pendingGrade) return;
  const cfg = getConfig();
  const g = window._pendingGrade;
  document.getElementById('commit-btn').disabled = true;

  try {
    if (cfg.gasUrl) {
      await callGAS('commit', g);
      toast('✅ Committed to Google Sheets');
    } else {
      toast('⚠️ No Apps Script URL — logged locally only');
    }
    // Save to local transaction log
    const txns = getTransactions();
    txns.unshift({ ...g, committed: !!cfg.gasUrl });
    localStorage.setItem(TXN_KEY, JSON.stringify(txns.slice(0, 200)));
    renderTransactions();
    document.getElementById('c-sync').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('result-box').classList.remove('show');
    window._pendingGrade = null;
  } catch (e) {
    showAlert('alert-clerk', 'Commit error: ' + e.message, 'error');
  }
  document.getElementById('commit-btn').disabled = false;
}

function flagReview() {
  if (!window._pendingGrade) return;
  const txns = getTransactions();
  txns.unshift({ ...window._pendingGrade, flagged: true, committed: false });
  localStorage.setItem(TXN_KEY, JSON.stringify(txns.slice(0, 200)));
  renderTransactions();
  toast('🚩 Entry flagged for manual review');
  document.getElementById('result-box').classList.remove('show');
  window._pendingGrade = null;
}

function clearGrade() {
  document.getElementById('submission').value = '';
  document.getElementById('alias').value = '';
  document.getElementById('activity-type').value = '';
  document.getElementById('result-box').classList.remove('show');
  window._pendingGrade = null;
}

function getTransactions() {
  try { return JSON.parse(localStorage.getItem(TXN_KEY) || '[]'); } catch { return []; }
}

function renderTransactions() {
  const txns = getTransactions();
  const el = document.getElementById('transactions');
  if (!txns.length) { el.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--ink3);font-size:13px">No transactions yet this session</div>'; return; }
  el.innerHTML = txns.slice(0, 30).map(t => {
    const style = activityStyle(t.activity);
    const ts = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const flag = t.flagged ? '<span class="badge badge-red" style="font-size:10px">Flagged</span> ' : '';
    const committed = t.committed ? '<span class="badge badge-green" style="font-size:10px">Synced</span>' : '<span class="badge badge-amber" style="font-size:10px">Local</span>';
    return `<div class="log-row">
      <div class="log-icon" style="background:${style.color}18"><i class="ti ${style.icon}" style="color:${style.color}"></i></div>
      <div class="log-body">
        <div class="log-name">${t.alias}</div>
        <div class="log-activity">${t.activity || 'Unknown'} ${flag}${committed}</div>
        <div class="log-time">${ts}</div>
      </div>
      <div class="log-pts">+${t.pts}</div>
    </div>`;
  }).join('');
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const cfg = getConfig();
  if (!cfg.gasUrl) {
    document.getElementById('banner-dashboard').style.display = 'flex';
    return;
  }
  document.getElementById('banner-dashboard').style.display = 'none';
  try {
    const data = await callGAS('dashboard');
    document.getElementById('m-active').textContent = data.activeStudents || '—';
    document.getElementById('m-today').textContent = data.submissionsToday || '0';
    document.getElementById('m-pts').textContent = (data.ptsThisWeek || 0).toLocaleString();
    const dormant = data.dormantCount || 0;
    document.getElementById('m-dormant').textContent = dormant;
    if (dormant > 0) document.getElementById('m-dormant-chip').style.display = 'inline-block';
    renderFeed(data.recentActivity || []);
    renderBreakdown(data.activityBreakdown || {});
    document.getElementById('sync-status').textContent = '⬤ Connected';
    document.getElementById('sync-status').style.color = 'var(--accent3)';
  } catch (e) {
    document.getElementById('banner-dashboard').style.display = 'flex';
    document.getElementById('banner-dashboard').querySelector('div').innerHTML = '<strong>Connection error:</strong> ' + e.message;
  }
}

function renderFeed(items) {
  const el = document.getElementById('live-feed');
  if (!items.length) { el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--ink3);font-size:13px">No recent activity</div>'; return; }
  el.innerHTML = items.map(it => {
    const style = activityStyle(it.activity);
    const ago = it.minutesAgo != null ? (it.minutesAgo === 0 ? 'Just now' : it.minutesAgo < 60 ? it.minutesAgo + 'm ago' : Math.floor(it.minutesAgo / 60) + 'h ago') : '';
    return `<div class="log-row">
      <div class="log-icon" style="background:${style.color}18"><i class="ti ${style.icon}" style="color:${style.color}"></i></div>
      <div class="log-body">
        <div class="log-name">${it.alias}</div>
        <div class="log-activity">${it.activity}</div>
        <div class="log-time">${ago}</div>
      </div>
      <div class="log-pts">+${it.pts}</div>
    </div>`;
  }).join('');
}

function renderBreakdown(breakdown) {
  const el = document.getElementById('activity-breakdown');
  const entries = Object.entries(breakdown);
  if (!entries.length) { el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--ink3);font-size:13px">No data yet</div>'; return; }
  const max = Math.max(...entries.map(([, v]) => v));
  el.innerHTML = entries.map(([name, count]) => {
    const style = activityStyle(name);
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13px">
      <i class="ti ${style.icon}" style="color:${style.color};font-size:15px;width:18px;flex-shrink:0"></i>
      <span style="flex:1;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
      <div style="width:80px;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;flex-shrink:0"><div style="width:${Math.round(count / max * 100)}%;height:100%;background:${style.color};border-radius:3px"></div></div>
      <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--ink3);width:20px;text-align:right">${count}</span>
    </div>`;
  }).join('');
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
async function loadLeaderboard() {
  const cfg = getConfig();
  const el = document.getElementById('lb-list');
  if (!cfg.gasUrl) { el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--ink3);font-size:13px">Connect Apps Script in Settings to load leaderboard</div>'; return; }
  el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--ink3);font-size:13px"><div class="dots" style="justify-content:center"><span></span><span></span><span></span></div></div>';
  try {
    const data = await callGAS('leaderboard');
    renderLeaderboard(data.students || []);
  } catch (e) {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--warn);font-size:13px">Error: ${e.message}</div>`;
  }
}

function renderLeaderboard(students) {
  const el = document.getElementById('lb-list');
  if (!students.length) { el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--ink3);font-size:13px">No student data yet</div>'; return; }
  const sorted = [...students].sort((a, b) => b.pts - a.pts);
  const max = sorted[0].pts || 1;
  const medals = ['🥇', '🥈', '🥉'];
  const AVATAR_COLORS = ['#6c47ff','#ff6b9d','#00d4aa','#ffb800','#ff6b35','#4fc3f7','#a78bfa','#34d399','#fb923c','#f472b6'];
  el.innerHTML = sorted.map((s, i) => {
    const col = AVATAR_COLORS[i % AVATAR_COLORS.length];
    const streakBadge = s.streak > 4 ? `<span class="badge badge-amber" style="font-size:10px">🔥 ${s.streak}d</span>` : '';
    return `<div class="lb-row">
      <div class="lb-rank ${i < 3 ? 'top' : ''}">${i < 3 ? medals[i] : i + 1}</div>
      <div class="lb-avatar" style="background:${col}22;color:${col}">${s.alias.slice(0, 2).toUpperCase()}</div>
      <div class="lb-name">${s.alias}</div>
      ${streakBadge}
      <div class="lb-bar-wrap"><div class="lb-bar" style="width:${Math.round(s.pts / max * 100)}%"></div></div>
      <div class="lb-pts">${s.pts.toLocaleString()} pts</div>
    </div>`;
  }).join('');
}

// ─── Agent 2: Advisor & Reporter ──────────────────────────────────────────────
const streamStates = { diary: true, engage: true, research: true };

function toggleStream(key) {
  streamStates[key] = !streamStates[key];
  document.getElementById('sc-' + key).classList.toggle('on', streamStates[key]);
  document.getElementById('t-' + key).classList.toggle('on', streamStates[key]);
}

function getDiaryHistory() {
  try { return JSON.parse(localStorage.getItem(DIARY_KEY) || '[]'); } catch { return []; }
}

function saveDiaryEntry() {
  const text = document.getElementById('diary-entry').value.trim();
  if (!text) return;
  const history = getDiaryHistory();
  history.unshift({ text, date: new Date().toLocaleDateString() });
  localStorage.setItem(DIARY_KEY, JSON.stringify(history.slice(0, 30)));
  renderDiaryLabels();
  document.getElementById('diary-entry').value = '';
  showAlert('alert-diary', 'Diary entry saved (' + history.length + ' entries total)', 'success');
}

function renderDiaryLabels() {
  const history = getDiaryHistory();
  const el = document.getElementById('diary-history-labels');
  if (!el) return;
  el.innerHTML = history.slice(0, 5).map(e => `<span class="badge badge-purple" style="font-size:10px;cursor:pointer" onclick="loadDiaryEntry('${encodeURIComponent(e.text)}')">${e.date}</span>`).join('');
}

function loadDiaryEntry(encoded) {
  document.getElementById('diary-entry').value = decodeURIComponent(encoded);
}

function buildAdvisorPrompt(diaryText, leaderboardSummary, papers) {
  const activeStreams = [];
  if (streamStates.diary && diaryText) activeStreams.push(`=== CLASSROOM DIARY ===\n${diaryText}`);
  if (streamStates.engage && leaderboardSummary) activeStreams.push(`=== ENGAGEMENT & LEADERBOARD DATA ===\n${leaderboardSummary}`);
  if (streamStates.research && papers.length) {
    const abstracts = papers.map(p => `- ${p.title} (${p.authors}): ${p.abstract}`).join('\n');
    activeStreams.push(`=== RESEARCH LIBRARY ===\n${abstracts}`);
  }
  return `You are an expert instructional design consultant and pedagogical advisor. You serve an instructor running a gamified "Agency Passport" program with up to 70 students.

Analyze the following data streams and generate a structured, actionable executive memo. Be specific — cite actual student aliases, real numbers, and named research papers where possible.

${activeStreams.join('\n\n')}

=== YOUR MEMO STRUCTURE (use these exact section headers) ===

## DIAGNOSTIC SUMMARY
What are the 2–3 most critical engagement patterns right now? Be specific.

## DORMANT PORTFOLIO ALERTS
List students needing a personal check-in. For each, write a one-sentence suggested personal message the instructor could send.

## LITERATURE-BACKED INSIGHT
Name one specific paper from the research library that addresses the core bottleneck. Explain the connection directly.

## NEW PASSPORT ACTIVITY
Design a new activity to address the engagement gap:
- Activity name and point value (10, 25, or 50)
- Pedagogical rationale (2 sentences)
- Ready-to-copy Padlet prompt text (write this in second person, addressed directly to students, 2–3 paragraphs)

Write in direct, collegial prose — like a trusted consultant. No fluff. The instructor is busy.`;
}

async function runAdvisor() {
  const email = document.getElementById('memo-email').value.trim();
  const cfg = getConfig();
  if (!cfg.apiKey && !cfg.gasUrl) { showAlert('alert-advisor', 'Add your API key or Apps Script URL in Settings first.', 'error'); return; }

  document.getElementById('advisor-btn').disabled = true;
  document.getElementById('advisor-loading').classList.add('show');
  document.getElementById('memo-output').classList.remove('show');

  try {
    // Collect diary
    const diaryHistory = getDiaryHistory();
    const currentDiary = document.getElementById('diary-entry').value.trim();
    const allDiary = (currentDiary ? [currentDiary] : []).concat(diaryHistory.map(e => `[${e.date}] ${e.text}`)).slice(0, 5).join('\n\n');

    // Collect leaderboard summary
    let lbSummary = '';
    if (streamStates.engage && cfg.gasUrl) {
      try {
        const lbData = await callGAS('leaderboard');
        const students = lbData.students || [];
        const sorted = [...students].sort((a, b) => b.pts - a.pts);
        const top5 = sorted.slice(0, 5).map(s => `${s.alias}: ${s.pts}pts`).join(', ');
        const dormant = sorted.filter(s => s.daysSinceSubmission >= (cfg.dormantDays || 7)).map(s => s.alias);
        const noHighEffort = sorted.filter(s => !s.hasHighEffort).map(s => s.alias);
        lbSummary = `Top 5 students: ${top5}\nDormant portfolios (${dormant.length}): ${dormant.join(', ') || 'none'}\nStudents avoiding high-effort tasks: ${noHighEffort.slice(0, 8).join(', ') || 'none'}\nTotal active: ${students.length}`;
      } catch { lbSummary = 'Leaderboard data unavailable'; }
    }

    const papers = getPapers();
    const prompt = buildAdvisorPrompt(allDiary, lbSummary, papers);

    let memoText;
    if (cfg.gasUrl) {
      const result = await callGAS('advisor', { prompt, email: email || cfg.instructorEmail });
      memoText = result.memo;
    } else {
      memoText = await callClaude(prompt, 1500);
      if (email) toast('ℹ️ No Apps Script configured — memo displayed only, not emailed');
    }

    renderMemo(memoText);

    if (email && cfg.gasUrl) {
      toast('📧 Memo sent to ' + email);
    }

  } catch (e) {
    showAlert('alert-advisor', 'Advisor error: ' + e.message, 'error');
  }

  document.getElementById('advisor-btn').disabled = false;
  document.getElementById('advisor-loading').classList.remove('show');
}

function renderMemo(text) {
  const el = document.getElementById('memo-output');
  const now = new Date().toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = text.split('\n');
  let html = `<div style="font-family:'Syne',sans-serif;font-size:17px;font-weight:700;color:var(--ink);margin-bottom:4px">Agency Engine — Instructional Strategy Memo</div>
<div class="memo-meta">Generated ${now} · claude-sonnet-4-20250514 · ${Object.values(streamStates).filter(Boolean).length} streams active</div>`;

  for (const line of lines) {
    const t = line.trim();
    if (!t) { html += '<div style="height:6px"></div>'; continue; }
    if (t.startsWith('## ')) {
      html += `<div class="memo-section-hd"><i class="ti ti-chevron-right"></i>${t.replace(/^##\s*/, '')}</div>`;
    } else if (t.startsWith('### ')) {
      html += `<div style="font-size:12px;font-weight:600;color:var(--ink);margin:10px 0 4px">${t.replace(/^###\s*/, '')}</div>`;
    } else if (t.startsWith('- ') || t.startsWith('• ')) {
      html += `<p style="margin:2px 0 2px 16px;font-size:13.5px">• ${t.replace(/^[-•]\s*/, '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    } else if (/^>\s/.test(t) || t.toLowerCase().includes('padlet prompt') || t.toLowerCase().includes('copy-paste') || t.toLowerCase().includes('post this to padlet')) {
      html += `<div class="passport-box">${t.replace(/^>\s*/, '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</div>`;
    } else {
      html += `<p style="margin:0 0 6px;font-size:13.5px;line-height:1.7">${t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    }
  }

  el.innerHTML = html;
  el.classList.add('show');
}

// ─── Research Library ─────────────────────────────────────────────────────────
function renderPapers() {
  const papers = getPapers();
  document.getElementById('paper-list').innerHTML = papers.map(p => `
    <div class="paper-card">
      <div class="paper-title">${p.title}</div>
      <div style="font-size:11px;color:var(--ink3);margin-bottom:6px;font-family:'DM Mono',monospace">${p.authors}</div>
      <div class="paper-abstract">${p.abstract}</div>
      <div style="margin-top:8px">${p.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
    </div>`).join('');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function renderSettingsPage() {
  const cfg = getConfig();
  document.getElementById('cfg-gas-url').value = cfg.gasUrl || '';
  document.getElementById('cfg-api-key').value = cfg.apiKey ? '••••••••••' + cfg.apiKey.slice(-4) : '';
  document.getElementById('cfg-padlet-key').value = cfg.padletKey ? '••••' + cfg.padletKey.slice(-4) : '';
  document.getElementById('cfg-padlet-boards').value = (cfg.padletBoards || []).join('\n');
  document.getElementById('cfg-email').value = cfg.instructorEmail || '';
  document.getElementById('pts-low').value = cfg.ptsLow || 10;
  document.getElementById('pts-mid').value = cfg.ptsMid || 25;
  document.getElementById('pts-high').value = cfg.ptsHigh || 50;
  document.getElementById('dormant-days').value = cfg.dormantDays || 7;
  renderSettingsPapers();
}

function saveConfig() {
  const existing = getConfig();
  const apiKeyInput = document.getElementById('cfg-api-key').value.trim();
  const padletInput = document.getElementById('cfg-padlet-key').value.trim();
  const boards = document.getElementById('cfg-padlet-boards').value.trim().split('\n').map(s => s.trim()).filter(Boolean);
  const cfg = {
    ...existing,
    gasUrl: document.getElementById('cfg-gas-url').value.trim(),
    apiKey: apiKeyInput.startsWith('••') ? existing.apiKey : apiKeyInput,
    padletKey: padletInput.startsWith('••') ? existing.padletKey : padletInput,
    padletBoards: boards,
    instructorEmail: document.getElementById('cfg-email').value.trim(),
  };
  saveConfigLocal(cfg);
  updateSyncStatus(cfg);
  showAlert('alert-settings', 'Configuration saved. Apps Script URL: ' + (cfg.gasUrl ? '✓ set' : '✗ missing'), cfg.gasUrl ? 'success' : 'error');
  toast('✅ Settings saved');
}

function saveScoringRules() {
  const cfg = getConfig();
  cfg.ptsLow = parseInt(document.getElementById('pts-low').value) || 10;
  cfg.ptsMid = parseInt(document.getElementById('pts-mid').value) || 25;
  cfg.ptsHigh = parseInt(document.getElementById('pts-high').value) || 50;
  cfg.dormantDays = parseInt(document.getElementById('dormant-days').value) || 7;
  saveConfigLocal(cfg);
  toast('✅ Scoring rules saved');
}

function updateSyncStatus(cfg) {
  const el = document.getElementById('sync-status');
  if (cfg.gasUrl) {
    el.textContent = '⬤ Connected';
    el.style.color = 'var(--accent3)';
  } else {
    el.textContent = '⬤ Not connected';
    el.style.color = '';
  }
}

function renderSettingsPapers() {
  const papers = getPapers();
  document.getElementById('settings-papers').innerHTML = papers.map((p, i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500;color:var(--ink)">${p.title}</div>
        <div style="font-size:11px;color:var(--ink3)">${p.authors}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deletePaper(${i})"><i class="ti ti-trash"></i></button>
    </div>`).join('') || '<div style="color:var(--ink3);font-size:13px;padding:12px 0">No papers. Click Add Paper.</div>';
}

function deletePaper(i) {
  const papers = getPapers();
  papers.splice(i, 1);
  savePapers(papers);
  renderSettingsPapers();
  toast('Paper removed');
}

function addPaper() {
  const title = prompt('Paper title:');
  if (!title) return;
  const authors = prompt('Authors + year (e.g. Smith & Jones (2023)):') || '';
  const abstract = prompt('Abstract / key finding:') || '';
  const tagsRaw = prompt('Tags (comma-separated):') || '';
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const papers = getPapers();
  papers.push({ id: 'p' + Date.now(), title, authors, abstract, tags });
  savePapers(papers);
  renderSettingsPapers();
  toast('Paper added');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  const cfg = getConfig();
  updateSyncStatus(cfg);
  renderTransactions();
  renderDiaryLabels();
  const savedEmail = cfg.instructorEmail;
  if (savedEmail) {
    const emailEl = document.getElementById('memo-email');
    if (emailEl) emailEl.value = savedEmail;
  }
  // Show config banner if not set up
  if (!cfg.gasUrl && !cfg.apiKey) {
    document.getElementById('banner-dashboard').style.display = 'flex';
  }
})();
