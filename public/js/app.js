const TEAMS = ["Vermelho", "Verde", "Azul", "Branco"];
const TEAM_COLORS = {
  Vermelho: "#ff4757",
  Verde: "#2ed573",
  Azul: "#3742fa",
  Branco: "#f1f2f6",
};
const TEAM_CSS = {
  Vermelho: "vermelho",
  Verde: "verde",
  Azul: "azul",
  Branco: "branco",
};

const $ = (id) => document.getElementById(id);

const screenPick = $("screen-pick");
const screenSpin = $("screen-spin");
const screenResult = $("screen-result");
const nameSelect = $("name-select");
const btnReveal = $("btn-reveal");
const pickError = $("pick-error");
const remainingHint = $("remaining-hint");
const spinName = $("spin-name");
const wheelCanvas = $("wheel");
const resultName = $("result-name");
const resultTeam = $("result-team");
const resultBadge = $("result-badge");

let wheelRotation = 0;

function showScreen(screen) {
  for (const el of [screenPick, screenSpin, screenResult]) {
    el.classList.remove("active");
    el.hidden = true;
  }
  screen.classList.add("active");
  screen.hidden = false;
}

function setError(message) {
  if (message) {
    pickError.textContent = message;
    pickError.hidden = false;
  } else {
    pickError.hidden = true;
    pickError.textContent = "";
  }
}

async function loadNames() {
  try {
    const res = await fetch("/api/names");
    if (!res.ok) throw new Error("Não foi possível carregar os nomes");
    const { names } = await res.json();

    nameSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
      names.length > 0 ? "Escolhe o teu nome..." : "Todos os nomes já foram escolhidos!";
    nameSelect.appendChild(placeholder);

    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      nameSelect.appendChild(opt);
    }

    nameSelect.disabled = names.length === 0;
    btnReveal.disabled = names.length === 0;

    const statsRes = await fetch("/api/stats");
    if (statsRes.ok) {
      const { remaining, total } = await statsRes.json();
      remainingHint.textContent =
        total > 0 ? `🎟️ ${remaining} de ${total} rodadas ainda por vir!` : "";
    }
  } catch {
    nameSelect.innerHTML =
      '<option value="">Não foi possível ligar — atualiza a página</option>';
    nameSelect.disabled = true;
    btnReveal.disabled = true;
  }
}

function drawWheel(rotationRad = 0) {
  const ctx = wheelCanvas.getContext("2d");
  const size = wheelCanvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 4;
  const slice = (Math.PI * 2) / TEAMS.length;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotationRad);

  TEAMS.forEach((team, i) => {
    const start = i * slice;
    const end = start + slice;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = TEAM_COLORS[team];
    ctx.fill();
    ctx.strokeStyle = "#2d3436";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + slice / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = team === "Branco" ? "#2d3436" : "#fff";
    ctx.font = "bold 17px Fredoka, Nunito, sans-serif";
    ctx.strokeStyle = team === "Branco" ? "transparent" : "rgba(0,0,0,0.2)";
    ctx.lineWidth = 3;
    ctx.strokeText(team, radius * 0.58, 0);
    ctx.fillText(team, radius * 0.58, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#ffd93d";
  ctx.fill();
  ctx.strokeStyle = "#2d3436";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function teamToSliceIndex(team) {
  return TEAMS.indexOf(team);
}

function spinToTeam(team) {
  return new Promise((resolve) => {
    const index = teamToSliceIndex(team);
    if (index < 0) {
      resolve();
      return;
    }
    const sliceDeg = 360 / TEAMS.length;
    const sliceMid = index * sliceDeg + sliceDeg / 2;
    const pointerOffset = 270;
    const targetMod = (pointerOffset - sliceMid + 360) % 360;
    const currentMod = ((wheelRotation % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;
    const extraSpins = 5 * 360;
    const finalDeg = wheelRotation + extraSpins + delta;
    const duration = 4200;
    const start = performance.now();
    const startRot = wheelRotation;

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const deg = startRot + (finalDeg - startRot) * eased;
      wheelRotation = deg;
      drawWheel((deg * Math.PI) / 180);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        wheelRotation = finalDeg;
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

async function claimAndReveal(name) {
  setError("");
  btnReveal.disabled = true;

  const res = await fetch("/api/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    setError(data.error || "Algo correu mal. Tenta outra vez.");
    btnReveal.disabled = false;
    return;
  }

  spinName.textContent = data.name;
  showScreen(screenSpin);
  drawWheel((wheelRotation * Math.PI) / 180);

  await spinToTeam(data.team);

  resultName.textContent = data.name;
  resultTeam.textContent = data.team;
  const cssTeam = TEAM_CSS[data.team] || data.team.toLowerCase();
  resultBadge.className = `team-badge team-${cssTeam}`;
  showScreen(screenResult);
}

nameSelect.addEventListener("change", () => setError(""));

btnReveal.addEventListener("click", () => {
  const name = nameSelect.value;
  if (!name) {
    setError("Hey — escolhe o teu nome primeiro!");
    return;
  }
  claimAndReveal(name);
});

drawWheel(0);
loadNames();
