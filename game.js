// stop-timer v2: combo + danger zone + slow-mo
export function createGame(opts){
  const {
    onUI,
    onState,
  } = opts;

  const st = {
    running:false,
    phase:'idle', // idle|running|resolve
    t:0,
    last:performance.now(),
    target: 5.00,
    window: 0.10,
    round: 0,
    score: 0,
    best: Number(localStorage.getItem('stopTimerBest') || 0),
    streak: 0,
    mult: 1,
    slowMo: 0,
    trap: false,
    trapAt: 0,
    trapWindow: 0.15,
    seed: Math.random()*1e9,
  };

  function clamp(v,a,b){return Math.max(a, Math.min(b,v));}
  function fmt(x){return x.toFixed(2);}

  function rng(){
    // xorshift32-ish
    let x = (st.seed|0) + 0x9e3779b9;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    st.seed = x;
    return ((x>>>0) / 4294967296);
  }

  function pickTarget(){
    const raw = 2.8 + rng()*6.2; // 2.8..9.0
    const step = 0.05;
    st.target = Math.round(raw/step)*step;

    // tighter window as you survive
    const base = 0.11;
    const minW = 0.035;
    const w = base - st.round*0.003;
    st.window = clamp(w, minW, 0.12);

    // occasional trap: a fake sweet-spot earlier
    st.trap = (st.round >= 3) && (rng() < 0.35);
    if (st.trap){
      const offset = 0.35 + rng()*0.8;
      st.trapAt = clamp(st.target - offset, 1.2, st.target - 0.25);
      st.trapWindow = clamp(st.window*1.4, 0.06, 0.18);
    }

    onUI?.({
      targetText: `target: ${fmt(st.target)}s  |  window: ±${fmt(st.window)}s`,
      trapText: st.trap ? `trap: ${fmt(st.trapAt)}s` : null,
    });
  }

  function resetTimer(){
    st.t = 0;
    st.phase = 'idle';
    st.running = false;
    onUI?.({timeText: fmt(0), bar: 0, status: 'ready'});
  }

  function setBest(){
    if (st.score > st.best){
      st.best = st.score;
      localStorage.setItem('stopTimerBest', String(st.best));
    }
  }

  function scoreFor(delta, window){
    // delta in seconds. Window sets difficulty.
    const d = Math.abs(delta);
    const sigma = Math.max(0.02, window*0.60);
    const s = Math.max(0, 1000 * Math.exp(- (d*d) / (2 * sigma * sigma)) );
    return Math.round(s);
  }

  function gradeFor(delta, window){
    const d = Math.abs(delta);
    if (d <= window*0.25) return 'laser';
    if (d <= window*0.60) return 'tight';
    if (d <= window) return 'ok';
    return 'miss';
  }

  function awardSlowMo(grade){
    // earn slow-mo charges for good hits
    if (grade === 'laser') st.slowMo = clamp(st.slowMo + 1.2, 0, 3);
    else if (grade === 'tight') st.slowMo = clamp(st.slowMo + 0.6, 0, 3);
    else if (grade === 'ok') st.slowMo = clamp(st.slowMo + 0.2, 0, 3);
  }

  function start(){
    st.running = true;
    st.phase = 'running';
    st.t = 0;
    onUI?.({
      status: 'running',
      canGo: false,
      canStop: true,
      result: 'Лови окно точности. Если видишь "trap" — это ловушка.',
    });
  }

  function stop(){
    if (!st.running) return;
    st.running = false;
    st.phase = 'resolve';

    const delta = st.t - st.target;
    let pts = scoreFor(delta, st.window);
    let grade = gradeFor(delta, st.window);

    // trap: if you stop near trap, you lose streak
    if (st.trap && Math.abs(st.t - st.trapAt) <= st.trapWindow){
      grade = 'trap';
      pts = 0;
      st.streak = 0;
      st.mult = 1;
      onUI?.({flash: 'trap'});
    }

    if (grade === 'miss'){
      st.streak = 0;
      st.mult = 1;
    } else if (grade !== 'trap'){
      st.streak += 1;
      st.mult = clamp(1 + Math.floor(st.streak/3)*0.5, 1, 4);
      awardSlowMo(grade);
    }

    const total = Math.round(pts * st.mult);
    st.score += total;
    setBest();

    const sign = delta >= 0 ? '+' : '';

    const msg = (grade === 'trap')
      ? `Ловушка. Остановил ${fmt(st.t)}s рядом с fake-окном → 0 pts. Streak сброшен.`
      : `Остановил ${fmt(st.t)}s (Δ ${sign}${fmt(delta)}s) → +${total} pts (base ${pts} ×${st.mult.toFixed(1)}), ${grade}.`;

    onUI?.({
      status: 'ready',
      canGo: true,
      canStop: false,
      score: st.score,
      best: st.best,
      streak: st.streak,
      mult: st.mult,
      slowMo: st.slowMo,
      result: msg + ' NEXT.',
    });
  }

  function next(){
    st.round += 1;
    pickTarget();
    resetTimer();
    onUI?.({
      canGo: true,
      canStop: false,
      result: 'Новый раунд. GO.',
    });
  }

  function useSlowMo(){
    if (!st.running) return;
    if (st.slowMo <= 0) return;
    st.slowMo = clamp(st.slowMo - 1, 0, 3);
    // brief slow-mo effect is handled in tick()
    onUI?.({slowMo: st.slowMo, flash: 'slow'});
  }

  function tick(now){
    const rawDt = Math.min(0.05, (now - st.last)/1000);
    st.last = now;

    if (!st.running){
      onState?.({dt: rawDt, t: st.t, running:false});
      return;
    }

    // apply slow mo if charged AND key held externally (we just consume on press)
    const slowFactor = 1.0;
    const dt = rawDt * slowFactor;

    st.t += dt;

    // bar wraps every 10 sec
    const bar = ((st.t % 10) / 10);

    // warning when near target window
    const near = Math.abs(st.t - st.target);
    const hot = near <= st.window;

    onUI?.({
      timeText: fmt(st.t),
      bar,
      hot,
      score: st.score,
      best: st.best,
      streak: st.streak,
      mult: st.mult,
      slowMo: st.slowMo,
    });

    // auto-stop if AFK
    if (st.t > 12.0) stop();

    onState?.({dt, t: st.t, running:true});
  }

  // init
  pickTarget();
  resetTimer();
  onUI?.({score: st.score, best: st.best, streak: st.streak, mult: st.mult, slowMo: st.slowMo, canGo:true, canStop:false});

  return { st, start, stop, next, useSlowMo, tick };
}
