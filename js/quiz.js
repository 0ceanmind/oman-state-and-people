/* Oman: State and People — interactive question bank */
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const THEMES = {
    '1': { n: 'Theme 1', t: 'Omani Identity', c: '#e8b86d' },
    '2': { n: 'Theme 2', t: 'Belonging, Loyalty & Citizenship', c: '#ff6b6b' },
    '3A': { n: 'Theme 3A', t: 'Contemporary Renaissance', c: '#4fc3f7' },
    '3B': { n: 'Theme 3B', t: 'Authenticity & Modernity', c: '#b79cff' },
    '4': { n: 'Theme 4', t: 'Renewed Renaissance', c: '#3ddc97' },
  };
  const ORDER = ['1', '2', '3A', '3B', '4'];
  const themeList = () => ORDER.map(k => [k, THEMES[k]]);
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('omanq:' + k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('omanq:' + k, JSON.stringify(v)); } catch { } },
  };
  let BANK = [], sel = new Set(Object.keys(THEMES)), mode = 'practice', count = '20';
  let run = null;

  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
  const show = id => { $$('.view').forEach(v => v.classList.toggle('on', v.id === id)); scrollTo({ top: 0, behavior: 'smooth' }); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  fetch('assets/data/questions.json').then(r => r.json()).then(data => { BANK = data; initStart(); });

  function initStart() {
    $('#total').textContent = BANK.length;
    $('#themes').innerHTML = themeList().map(([k, v]) =>
      `<button class="chip on" data-k="${k}" style="--c:${v.c}">${v.n}<small>${v.t} · ${BANK.filter(q => q.theme === k).length} Q</small></button>`).join('');
    $('#themes').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; b.classList.toggle('on'); sel.has(b.dataset.k) ? sel.delete(b.dataset.k) : sel.add(b.dataset.k); if (!sel.size) { sel.add(b.dataset.k); b.classList.add('on'); } };
    segs('#mode', v => mode = v); segs('#count', v => count = v);
    $('#start').onclick = () => begin(BANK.filter(q => sel.has(q.theme)));
    $('#review').onclick = () => begin(BANK.filter(q => store.get('wrong', []).includes(q.id)), true);
    renderMastery(); hud();
  }
  function segs(id, cb) { $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; $$(id + ' button').forEach(x => x.classList.toggle('on', x === b)); cb(b.dataset.v); }; }

  function renderMastery() {
    const st = store.get('stats', {});
    const wrong = store.get('wrong', []);
    $('#review').hidden = !wrong.length; $('#wrongN').textContent = wrong.length;
    const any = Object.keys(st).length;
    $('#mastery').innerHTML = !any ? '' : themeList().map(([k, v]) => {
      const s = st[k] || { c: 0, n: 0 }; const p = s.n ? Math.round(s.c / s.n * 100) : 0;
      return `<div class="m" style="--c:${v.c}"><b>${v.n}</b><span>${s.n ? p + '%' : '—'}</span><i style="--w:${p}%"></i></div>`;
    }).join('');
  }

  function begin(pool, isReview) {
    if (!pool.length) return;
    let qs = shuffle(pool);
    if (!isReview && count !== 'all') qs = qs.slice(0, +count);
    // shuffle options for mcq (keep True/False order)
    qs = qs.map(q => {
      if (q.type === 'tf') return { ...q, opts: q.options.map((o, i) => ({ o, i })) };
      return { ...q, opts: shuffle(q.options.map((o, i) => ({ o, i }))) };
    });
    run = { qs, i: 0, ans: [], t0: Date.now(), mode: isReview ? 'practice' : mode };
    show('v-q'); renderQ();
  }

  function hud() {
    if (!run) { $('#hud').innerHTML = ''; $('#prog').style.width = 0; return; }
    const ok = run.ans.filter(a => a.ok).length, bad = run.ans.length - ok;
    const s = Math.floor((Date.now() - run.t0) / 1000);
    $('#hud').innerHTML = (run.mode === 'practice' ? `<span class="ok">✓ ${ok}</span><span class="bad">✕ ${bad}</span>` : '') + `<span>${String(s / 60 | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}</span>`;
    $('#prog').style.width = (run.ans.length / run.qs.length * 100) + '%';
  }
  setInterval(() => run && $('#v-q').classList.contains('on') && hud(), 1000);

  function renderQ() {
    const q = run.qs[run.i], th = THEMES[q.theme];
    document.documentElement.style.setProperty('--accent', th.c);
    $('#qtheme').textContent = th.n; $('#qtopic').textContent = q.topic || th.t;
    $('#qnum').textContent = `${run.i + 1} / ${run.qs.length}`;
    $('#qtext').textContent = q.q;
    $('#answers').innerHTML = q.opts.map((x, j) => `<button class="ans" data-j="${j}"><span class="k">${'ABCD'[j]}</span><span>${esc(x.o)}</span></button>`).join('');
    $('#explain').hidden = true; $('#next').hidden = true;
    $('#answers').onclick = e => { const b = e.target.closest('.ans'); if (b) pick(+b.dataset.j); };
    hud();
  }

  function pick(j) {
    const q = run.qs[run.i];
    if (run.ans[run.i]) return;
    const chosen = q.opts[j].i, ok = chosen === q.answer;
    run.ans[run.i] = { id: q.id, theme: q.theme, ok, chosen };
    const btns = $$('.ans');
    btns.forEach(b => b.classList.add('done'));
    if (run.mode === 'practice') {
      btns.forEach((b, k) => { const oi = q.opts[k].i; if (oi === q.answer) b.classList.add('right'); else if (k === j) b.classList.add('wrong'); else b.classList.add('dim'); });
      const ex = $('#explain');
      ex.innerHTML = `<b>${ok ? 'Correct.' : 'Not quite.'}</b> ${esc(q.explain || '')}` + (q.note ? `<span class="note">Note: ${esc(q.note)}</span>` : '') + (q.source ? `<span class="src">Source · ${esc(q.source)}</span>` : '');
      ex.hidden = false;
      $('#next').hidden = false; $('#next').textContent = run.i === run.qs.length - 1 ? 'See results' : 'Next';
      $('#next').focus({ preventScroll: true });
    } else {
      btns[j].classList.add('sel');
      setTimeout(advance, 380);
    }
    hud();
  }
  function advance() { if (run.i < run.qs.length - 1) { run.i++; renderQ(); } else finish(); }
  $('#next').onclick = advance;

  addEventListener('keydown', e => {
    if (!run || !$('#v-q').classList.contains('on')) return;
    const k = e.key.toUpperCase();
    const map = { '1': 0, '2': 1, '3': 2, '4': 3, A: 0, B: 1, C: 2, D: 3, T: 0, F: 1 };
    if (k in map && !run.ans[run.i]) { const j = map[k]; if (j < run.qs[run.i].opts.length) pick(j); }
    else if ((e.key === 'Enter' || e.key === 'ArrowRight') && run.ans[run.i]) { e.preventDefault(); advance(); }
  });

  function finish() {
    const ok = run.ans.filter(a => a.ok).length, n = run.qs.length, p = Math.round(ok / n * 100);
    const secs = Math.round((Date.now() - run.t0) / 1000);
    // persist stats + wrong list
    const st = store.get('stats', {}); let wrong = new Set(store.get('wrong', []));
    run.ans.forEach(a => { st[a.theme] = st[a.theme] || { c: 0, n: 0 }; st[a.theme].n++; if (a.ok) { st[a.theme].c++; wrong.delete(a.id); } else wrong.add(a.id); });
    store.set('stats', st); store.set('wrong', [...wrong]);

    show('v-res');
    document.documentElement.style.setProperty('--accent', p >= 80 ? '#3ddc97' : p >= 60 ? '#e8b86d' : '#ff6b6b');
    $('#ringt').textContent = p + '%'; $('#rings').textContent = `${ok} of ${n}`;
    requestAnimationFrame(() => setTimeout(() => $('#ringv').style.strokeDashoffset = 590.6 * (1 - ok / n), 120));
    $('#verdictE').textContent = p >= 90 ? 'Outstanding' : p >= 75 ? 'Strong' : p >= 50 ? 'Getting there' : 'Keep revising';
    $('#verdict').innerHTML = p >= 90 ? 'You <em>own</em> this chapter.' : p >= 75 ? 'Nearly <em>exam-ready.</em>' : p >= 50 ? 'Solid base — <em>close the gaps.</em>' : 'Revisit the slides, <em>then retry.</em>';
    $('#resline').textContent = `${run.mode === 'exam' ? 'Exam mode' : 'Practice mode'} · ${Math.floor(secs / 60)} min ${secs % 60} s · ${Math.round(secs / n)} s per question`;
    const by = {};
    run.ans.forEach(a => { by[a.theme] = by[a.theme] || { c: 0, n: 0 }; by[a.theme].n++; if (a.ok) by[a.theme].c++; });
    $('#tbars').innerHTML = ORDER.filter(k => by[k]).map(k => [k, by[k]]).map(([k, s]) => { const v = THEMES[k]; const pp = Math.round(s.c / s.n * 100); return `<div class="tb" style="--c:${v.c}"><b>${v.n}</b><i style="--w:0%" data-w="${pp}%"></i><span>${s.c}/${s.n}</span></div>`; }).join('');
    setTimeout(() => $$('.tb i').forEach(i => i.style.setProperty('--w', i.dataset.w)), 200);
    const missed = run.qs.filter((q, i) => !run.ans[i].ok);
    $('#revH').textContent = missed.length ? `Review · ${missed.length} missed` : 'Perfect — nothing to review';
    $('#rlist').innerHTML = missed.map(q => {
      const a = run.ans[run.qs.indexOf(q)];
      return `<div class="rv"><h4>${esc(q.q)}</h4><p><span class="y">Your answer: ${esc(q.options[a.chosen])}</span><br><span class="c">Correct: ${esc(q.options[q.answer])}</span></p><p style="margin-top:.5rem">${esc(q.explain || '')}</p>${q.note ? `<p style="margin-top:.4rem;color:#f3d9ae">Note: ${esc(q.note)}</p>` : ''}</div>`;
    }).join('');
    $('#retryWrong').hidden = !missed.length;
    $('#retryWrong').onclick = () => begin(BANK.filter(q => missed.some(m => m.id === q.id)), true);
    $('#again').onclick = () => { run = null; hud(); renderMastery(); show('v-start'); };
    $('#prog').style.width = '100%';
  }
})();
