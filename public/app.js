const user = JSON.parse(localStorage.getItem('user') || 'null');
if (!user) location.href = '/';

const urlParams = new URLSearchParams(location.search);
const role = urlParams.get('role') || user.role;

const socket = io();
const thread = document.getElementById('thread');
const convList = document.getElementById('convList');

let currentAlumnoId = null;
let profeId = null;

const chat = document.querySelector('.chat');
const divEsp = document.getElementById('sensor-data');

if (role === 'alumno') {
  if (divEsp) divEsp.remove();
  if (chat) chat.style.width = '100%';
} else {
  if (chat) chat.style.width = '70%';
}

const dashboardEls = {
  heartRate: document.getElementById('heartRate'),
  temperature: document.getElementById('temperature'),
  irValue: document.getElementById('irValue'),
  accX: document.getElementById('accX'),
  accY: document.getElementById('accY'),
  accZ: document.getElementById('accZ'),
  gyroX: document.getElementById('gyroX'),
  gyroY: document.getElementById('gyroY'),
  gyroZ: document.getElementById('gyroZ'),
  rmssd: document.getElementById('rmssd'),
  connectionStatus: document.getElementById('connectionStatus'),
  lastUpdate: document.getElementById('lastUpdate')
};

function addMessage({ from, text, ts, tempId }) {
  if (tempId && document.querySelector(`[data-tempid="${tempId}"]`)) return;

  const el = document.createElement('div');
  el.className = 'msg' + ((from === user.id) ? ' me' : '');
  if (tempId) el.dataset.tempid = tempId;

  el.innerHTML = `
    <div>${text}</div>
    <div class="meta">${new Date(ts).toLocaleTimeString()}</div>
  `;

  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

function logout() {
  localStorage.removeItem('user');
  location.href = '/';
}

(async function init() {
  if (role === 'alumno') {
    currentAlumnoId = user.username;

    socket.emit('join', {
      role: 'alumno',
      alumnoId: currentAlumnoId,
      profeId: user.profeId,
      selfId: user.id
    });

    socket.emit("joinRoom", `${currentAlumnoId}-${user.profeId}`);
    convList.innerHTML = `<div class="item active">Tu profesor</div>`;
    cargarHistorial(currentAlumnoId, user.profeId);

  } else {
    profeId = user.username;

    try {
      const res = await fetch('/api/alumnos?profeId=' + encodeURIComponent(profeId));
      if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
      const alumnos = await res.json();

      console.log('Alumnos recibidos:', alumnos);

      convList.innerHTML = '';
      if (!Array.isArray(alumnos) || alumnos.length === 0) {
        convList.innerHTML = "<p style='color:gray'>No hay alumnos asignados</p>";
        return;
      }

      alumnos.forEach(al => {
        if (!al.username) return;
        const item = document.createElement('div');
        item.className = 'item';
        item.dataset.username = al.username;
        item.innerHTML = al.name || al.username;
        item.onclick = () => selectAlumno(al.username, item);
        convList.appendChild(item);
      });

      const first = convList.querySelector('.item');
      if (first) selectAlumno(first.dataset.username, first);

    } catch (err) {
      console.error("❌ Error cargando alumnos:", err);
      convList.innerHTML = "<p style='color:red'>Error cargando alumnos</p>";
    }
  }
})();

async function cargarHistorial(alumnoId, profeId) {
  try {
    const res = await fetch(`/api/messages/${alumnoId}/${profeId}`);
    if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
    const history = await res.json();

    thread.innerHTML = "";
    if (!Array.isArray(history) || history.length === 0) {
      thread.innerHTML = "<p style='color:gray'>Sin historial</p>";
      return;
    }

    history.forEach(msg => addMessage({ from: msg.user_id, text: msg.content, ts: msg.ts }));
  } catch (err) {
    console.error("❌ Error cargando historial:", err);
    thread.innerHTML = "<p style='color:red'>Error cargando historial</p>";
  }
}

async function selectAlumno(alumnoUsername, itemEl) {
  [...convList.children].forEach(c => c.classList.remove('active'));
  itemEl.classList.add('active');

  currentAlumnoId = alumnoUsername;
  await cargarHistorial(currentAlumnoId, profeId);

  socket.emit('join', {
    role: 'profesor',
    alumnoId: currentAlumnoId,
    profeId,
    selfId: user.id
  });

  socket.emit("joinRoom", `${currentAlumnoId}-${profeId}`);
}

socket.off('message');
socket.on('message', (msg) => {
  addMessage({
    from: msg.user_id || msg.from,
    text: msg.text || msg.content,
    ts: msg.ts || Date.now(),
    tempId: msg.tempId
  });
});

socket.on('sensorData', (data) => {
  // Ritmo cardíaco
  if (dashboardEls.heartRate) 
      dashboardEls.heartRate.innerHTML = `${(data.bpm||0).toFixed(1)} BPM`;

  // Temperatura
  if (dashboardEls.temperature) 
      dashboardEls.temperature.innerHTML = `${(data.temperatura||0).toFixed(1)} °C`;

  // Sensor IR
  if (dashboardEls.irValue) 
      dashboardEls.irValue.innerHTML = `${(data.ir||0)}`;

  // Movimiento (la ESP envía 'movimiento')
  if (dashboardEls.accX) 
      dashboardEls.accX.innerHTML = `${(data.movimiento||0).toFixed(2)}`;

  // RMSSD
  if (dashboardEls.rmssd) 
      dashboardEls.rmssd.innerHTML = `${(data.rmssd||0).toFixed(1)}`;

  // Estado Emocional (moodValue) → usamos 'estadoAlumno'
  if (dashboardEls.moodValue) {
      const moods = ["😃 Verde", "😐 Amarillo", "😡 Rojo"];
      dashboardEls.moodValue.innerHTML = moods[data.estadoAlumno] || "--";
  }

  // Estado Emocional (moodValue)
  if (dashboardEls.moodValue) {
    const estado = parseInt(data.estadoAlumno); // forzamos entero
    const moods = ["😃 Verde", "😐 Amarillo", "😡 Rojo"];
    dashboardEls.moodValue.innerHTML = moods[estado] || "--";
  }

});


window.sendMsg = function () {
  const input = document.getElementById('msg');
  const text = input.value.trim();
  if (!text) return;

  const tempId = 'temp-' + Date.now();

  addMessage({ from: user.id, text, ts: Date.now(), tempId });

  socket.emit('message', {
    text,
    alumnoId: currentAlumnoId,
    tempId,
    from: user.id
  });

  input.value = '';
};
