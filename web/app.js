(function () {
  const FPS = 25;
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

  let state = {
    session: null,
    frameIndex: 0,
    playing: true,
    speedIndex: 2, // 1x
    lastTime: null,
    worldScale: 1,
    worldTx: 0,
    worldTy: 0,
    worldCx: 0,
    worldCy: 0,
    rotRad: 0,
    cosRot: 1,
    sinRot: 0,
    leftMargin: 0,
    rightMargin: 260,
  };

  const canvas = document.getElementById("replayCanvas");
  const ctx = canvas.getContext("2d");
  const yearSelect = document.getElementById("yearSelect");
  const roundSelect = document.getElementById("roundSelect");
  const sessionSelect = document.getElementById("sessionSelect");
  const loadBtn = document.getElementById("loadBtn");
  const loadingEl = document.getElementById("loading");
  const sessionTitle = document.getElementById("sessionTitle");
  const timeLap = document.getElementById("timeLap");
  const leaderboardEl = document.getElementById("leaderboard");
  const playPauseBtn = document.getElementById("playPause");
  const speedDownBtn = document.getElementById("speedDown");
  const speedUpBtn = document.getElementById("speedUp");
  const speedLabel = document.getElementById("speedLabel");

  function worldToScreen(x, y) {
    let wx = x - state.worldCx;
    let wy = y - state.worldCy;
    if (state.rotRad) {
      const rx = wx * state.cosRot - wy * state.sinRot;
      const ry = wx * state.sinRot + wy * state.cosRot;
      wx = rx;
      wy = ry;
    }
    wx += state.worldCx;
    wy += state.worldCy;
    return [
      state.worldScale * wx + state.worldTx,
      state.worldScale * wy + state.worldTy,
    ];
  }

  function updateScaling() {
    if (!state.session || !state.session.track) return;
    const t = state.session.track;
    const xMin = t.x_min;
    const xMax = t.x_max;
    const yMin = t.y_min;
    const yMax = t.y_max;
    state.worldCx = (xMin + xMax) / 2;
    state.worldCy = (yMin + yMax) / 2;

    const rotDeg = state.session.session_info.circuit_rotation || 0;
    state.rotRad = (rotDeg * Math.PI) / 180;
    state.cosRot = Math.cos(state.rotRad);
    state.sinRot = Math.sin(state.rotRad);

    const padding = 0.08;
    const innerW = canvas.width - state.leftMargin - state.rightMargin;
    const innerH = canvas.height;
    const worldW = Math.max(1, xMax - xMin);
    const worldH = Math.max(1, yMax - yMin);
    const scaleX = (innerW * (1 - 2 * padding)) / worldW;
    const scaleY = (innerH * (1 - 2 * padding)) / worldH;
    state.worldScale = Math.min(scaleX, scaleY);
    const screenCx = state.leftMargin + innerW / 2;
    const screenCy = innerH / 2;
    state.worldTx = screenCx - state.worldScale * state.worldCx;
    state.worldTy = screenCy - state.worldScale * state.worldCy;
  }

  function drawTrack() {
    if (!state.session || !state.session.track) return;
    const t = state.session.track;
    ctx.fillStyle = "#1a2e1a";
    ctx.strokeStyle = "#2d4a2d";
    ctx.lineWidth = 2;

    const inner = [];
    for (let i = 0; i < t.inner_x.length; i++) {
      inner.push(worldToScreen(t.inner_x[i], t.inner_y[i]));
    }
    const outer = [];
    for (let i = 0; i < t.outer_x.length; i++) {
      outer.push(worldToScreen(t.outer_x[i], t.outer_y[i]));
    }
    ctx.beginPath();
    inner.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    outer.reverse();
    outer.forEach((p, i) => ctx.lineTo(p[0], p[1]));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // DRS zones (simplified: draw as segments)
    ctx.strokeStyle = "rgba(0, 200, 255, 0.6)";
    ctx.lineWidth = 4;
    (t.drs_zones || []).forEach((z) => {
      const s = worldToScreen(z.start.x, z.start.y);
      const e = worldToScreen(z.end.x, z.end.y);
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(e[0], e[1]);
      ctx.stroke();
    });
  }

  function drawCars() {
    if (!state.session || !state.session.frames.length) return;
    const frame = state.session.frames[Math.min(state.frameIndex, state.session.frames.length - 1)];
    const drivers = frame.drivers || {};
    const colors = state.session.driver_colors || {};

    Object.entries(drivers).forEach(([code, d]) => {
      const [sx, sy] = worldToScreen(d.x, d.y);
      const hex = colors[code] || "#808080";
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(code, sx, sy + 18);
    });
  }

  function draw() {
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTrack();
    drawCars();

    const frame = state.session.frames[Math.min(state.frameIndex, state.session.frames.length - 1)];
    const t = frame ? frame.t : 0;
    const lap = frame ? frame.lap : 0;
    const totalLaps = state.session.session_info.total_laps || 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const timeStr = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${timeStr}  Lap ${lap}/${totalLaps}`, 20, canvas.height - 24);
  }

  function updateLeaderboard() {
    if (!state.session || !state.session.frames.length) return;
    const frame = state.session.frames[Math.min(state.frameIndex, state.session.frames.length - 1)];
    const drivers = frame.drivers || {};
    const colors = state.session.driver_colors || {};
    const order = Object.entries(drivers)
      .map(([code, d]) => ({ code, ...d }))
      .sort((a, b) => (b.dist || 0) - (a.dist || 0));

    leaderboardEl.innerHTML = order
      .map(
        (d, i) =>
          `<li><span class="pos">${i + 1}</span><span class="dot" style="background:${colors[d.code] || "#888"}"></span><span class="code">${d.code}</span></li>`
      )
      .join("");
  }

  function tick(now) {
    if (!state.session || !state.session.frames.length) {
      requestAnimationFrame(tick);
      return;
    }
    if (state.lastTime == null) state.lastTime = now;
    const dt = (now - state.lastTime) / 1000;
    state.lastTime = now;

    if (state.playing) {
      const speed = SPEEDS[state.speedIndex];
      state.frameIndex += speed * FPS * dt;
      if (state.frameIndex >= state.session.frames.length) state.frameIndex = state.session.frames.length - 1;
      if (state.frameIndex < 0) state.frameIndex = 0;
    }

    draw();
    updateLeaderboard();

    const frame = state.session.frames[Math.min(Math.floor(state.frameIndex), state.session.frames.length - 1)];
    const t = frame ? frame.t : 0;
    const lap = frame ? frame.lap : 0;
    const totalLaps = state.session.session_info.total_laps || 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const timeStr = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
    timeLap.textContent = `${timeStr}  Lap ${lap} / ${totalLaps}`;

    requestAnimationFrame(tick);
  }

  async function loadYears() {
    const res = await fetch("/api/years");
    const years = await res.json();
    yearSelect.innerHTML = years.map((y) => `<option value="${y}" ${y === new Date().getFullYear() ? "selected" : ""}>${y}</option>`).join("");
  }

  async function loadRounds() {
    const year = parseInt(yearSelect.value, 10);
    roundSelect.innerHTML = "<option value="">Loading…</option>";
    const res = await fetch(`/api/rounds?year=${year}`);
    const rounds = await res.json();
    roundSelect.innerHTML = rounds.map((r) => `<option value="${r.round_number}">${r.round_number}: ${r.event_name}</option>`).join("");
  }

  async function loadSession() {
    const year = parseInt(yearSelect.value, 10);
    const round = parseInt(roundSelect.value, 10);
    const sessionType = sessionSelect.value;
    if (!year || !round) {
      alert("Please select year and round.");
      return;
    }
    loadBtn.disabled = true;
    loadingEl.classList.remove("hidden");
    try {
      const res = await fetch(`/api/session?year=${year}&round_number=${round}&session_type=${sessionType}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || res.statusText);
      }
      state.session = await res.json();
      state.frameIndex = 0;
      state.playing = true;
      state.lastTime = null;
      updateScaling();
      sessionTitle.textContent = state.session.session_info.event_name + " – " + (sessionType === "S" ? "Sprint" : "Race");
      playPauseBtn.textContent = "Pause";
    } catch (e) {
      alert("Failed to load session: " + e.message);
    } finally {
      loadingEl.classList.add("hidden");
      loadBtn.disabled = false;
    }
  }

  playPauseBtn.addEventListener("click", () => {
    state.playing = !state.playing;
    playPauseBtn.textContent = state.playing ? "Pause" : "Play";
  });
  speedDownBtn.addEventListener("click", () => {
    if (state.speedIndex > 0) state.speedIndex--;
    speedLabel.textContent = SPEEDS[state.speedIndex] + "×";
  });
  speedUpBtn.addEventListener("click", () => {
    if (state.speedIndex < SPEEDS.length - 1) state.speedIndex++;
    speedLabel.textContent = SPEEDS[state.speedIndex] + "×";
  });

  yearSelect.addEventListener("change", loadRounds);
  loadBtn.addEventListener("click", loadSession);

  loadYears().then(() => loadRounds());
  requestAnimationFrame(tick);
})();
