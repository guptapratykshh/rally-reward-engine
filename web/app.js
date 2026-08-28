const USER_KEY = 'rally.userId';

const $ = (id) => document.getElementById(id);

function userId() {
  return $('user-id').value.trim() || '123';
}

function setBar(el, ratio) {
  el.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body.code ?? res.status;
    throw new Error(String(code));
  }
  return body;
}

function renderSnapshot(snap) {
  const { player, progress, matches, grants } = snap;
  $('stat-coins').textContent = String(player.coins);
  $('stat-loot').textContent = String(player.lootBoxes);
  $('stat-streak').textContent = String(progress.currentStreak);
  $('stat-combo').textContent = `×${player.comboMultiplier}`;
  $('combo-hint').textContent = progress.comboActive ? 'Active this hour' : 'Inactive';
  $('combo-card').classList.toggle('hot', progress.comboActive);

  const streakCycle = progress.currentStreak % 3;
  $('q1-count').textContent = `${streakCycle} / 3`;
  setBar($('q1-bar'), streakCycle / 3);

  $('q2-count').textContent = `${Math.min(progress.matchesToday, 5)} / 5`;
  setBar($('q2-bar'), progress.matchesToday / 5);
  $('q2-claimed').textContent = progress.dailyClaimed ? 'yes' : 'no';

  $('q3-count').textContent = `${Math.min(progress.algebraWinsLastHour, 2)} / 2`;
  setBar($('q3-bar'), progress.algebraWinsLastHour / 2);

  const tape = $('tape');
  tape.replaceChildren();
  const recent = [...matches].reverse().slice(0, 24);
  if (recent.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No matches yet.';
    empty.style.color = 'var(--mute)';
    tape.append(empty);
  }
  for (const match of recent) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = `${match.gameType} · ${fmtTime(match.timeInterval)}`;
    const pill = document.createElement('span');
    pill.className = `pill ${match.result}`;
    pill.textContent = match.result;
    li.append(left, pill);
    tape.append(li);
  }

  const list = $('grants');
  list.replaceChildren();
  if (grants.length === 0) {
    const empty = document.createElement('li');
    empty.innerHTML = '<p>No grants yet. Win three straight, or play five today.</p>';
    list.append(empty);
  }
  for (const grant of grants) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = `${grant.kind} · ${grant.ruleId.replaceAll('_', ' ')}`;
    const right = document.createElement('span');
    right.textContent = grant.kind === 'COINS' ? `+${grant.amount}` : `+${grant.amount}`;
    li.append(left, right);
    list.append(li);
  }
}

function emptySnapshot() {
  return {
    matches: [],
    grants: [],
    player: {
      userId: userId(),
      coins: 0,
      lootBoxes: 0,
      comboMultiplier: 1,
      comboExpiresAt: null,
    },
    progress: {
      currentStreak: 0,
      matchesToday: 0,
      algebraWinsLastHour: 0,
      comboActive: false,
      streakInCycle: 0,
      dailyClaimed: false,
    },
  };
}

function showFlash(text, dup = false) {
  const el = $('flash');
  el.hidden = false;
  el.classList.toggle('dup', dup);
  el.textContent = text;
}

async function loadPlayer() {
  const snap = await api(`/api/state/${encodeURIComponent(userId())}`);
  renderSnapshot(snap);
}

async function resetAll() {
  renderSnapshot(emptySnapshot());
  const lab = $('lab-out');
  lab.hidden = true;
  lab.textContent = '';
  showFlash('Resetting…');
  await api('/api/reset', { method: 'POST', body: '{}' });
  await loadPlayer();
  showFlash('Back to default. Coins, loot, streak, and combo are 0.');
}

async function submitMatch(result) {
  const gameType = document.querySelector('input[name="gameType"]:checked').value;
  const body = await api('/api/matches', {
    method: 'POST',
    body: JSON.stringify({ userId: userId(), gameType, result }),
  });
  if (body.kind === 'DUPLICATE') {
    showFlash(`Match ${body.matchId} already settled. No double grant.`, true);
  } else if (body.grants?.length) {
    const bits = body.grants.map((g) => `${g.kind} ${g.amount}`).join(', ');
    showFlash(`Applied ${body.matchId}. Granted ${bits}.`);
  } else {
    showFlash(`Applied ${body.matchId}. No rule fired.`);
  }
  await loadPlayer();
}

$('load-btn').addEventListener('click', async () => {
  localStorage.setItem(USER_KEY, userId());
  await loadPlayer();
});

$('user-id').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  localStorage.setItem(USER_KEY, userId());
  await loadPlayer();
});

$('match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitter = e.submitter;
  const result = submitter?.value === 'lost' ? 'lost' : 'win';
  try {
    await submitMatch(result);
  } catch (err) {
    showFlash(`Could not record match: ${err.message}`, true);
  }
});

$('lab-btn').addEventListener('click', async () => {
  const out = $('lab-out');
  out.hidden = false;
  out.textContent = 'Running T0…';
  try {
    const body = await api('/api/lab/t0', {
      method: 'POST',
      body: JSON.stringify({ userId: userId() }),
    });
    out.textContent = [
      `Already in DB: ${body.history.join(' → ')}`,
      `Concurrent requests: ${body.concurrentRequests} (win + loss, same instant)`,
      `Lock: ${body.lock?.how ?? ''}`,
      '',
      JSON.stringify(
        {
          requests: body.requests,
          outcomes: body.outcomes,
          coins: body.snapshot?.player?.coins,
          liveStreak: body.snapshot?.progress?.currentStreak,
        },
        null,
        2,
      ),
    ].join('\n');
    await loadPlayer();
  } catch (err) {
    out.textContent = String(err.message);
  }
});

$('reset-btn').addEventListener('click', async () => {
  try {
    await resetAll();
  } catch (err) {
    showFlash(`Could not refresh: ${err.message}`, true);
  }
});

const saved = localStorage.getItem(USER_KEY);
$('user-id').value = saved || '123';
loadPlayer().catch((err) => showFlash(`Backend unreachable: ${err.message}`, true));
