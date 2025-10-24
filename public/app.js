const user = JSON.parse(localStorage.getItem('user') || 'null');
if (!user) location.href = '/';

const urlParams = new URLSearchParams(location.search);
const role = urlParams.get('role') || user.role;

const socket = io();
const thread = document.getElementById('thread');
const convList = document.getElementById('convList');

let currentAlumnoId = null;
let profeId = null;

socket.on('connect', () => {
  console.log('🟢 Conectado al servidor Socket.io');
});

// Elementos del dashboard (solo para el profesor)
const chat = document.querySelector('.chat');
const divEsp = document.getElementById('sensor-data');

if (role === 'alumno') {
  divEsp.remove();
  chat.style.width = '100%';
} else {
  chat.style.width = '70%';
}

// Guardar referencias del dashboard
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
  connectionStatus: document.getElementById('connectionStatus'),
  lastUpdate: document.getElementById('lastUpdate')
};

function addMessage({ from, text, ts, kind, tempId }) {
  // Evitar duplicados por si se llama manualmente
  if (tempId && document.querySelector(`[data-tempid="${tempId}"]`)) return;

  const el = document.createElement('div');
  el.className = 'msg' + ((from === user.id) ? ' me' : '');
  if (tempId) el.dataset.tempid = tempId;

  el.innerHTML = `<div>${text}</div><div class="meta">${new Date(ts).toLocaleTimeString()}</div>`;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

function logout() {
  localStorage.removeItem('user');
  location.href = '/';
}

(async function init() {
  if (role === 'alumno') {
    const alumnoUsername = user.username;
    currentAlumnoId = alumnoUsername;
    socket.emit('join', {
      role: 'alumno',
      alumnoId: alumnoUsername,
      profeId: user.profeId || 'profe1', // asegúrate de enviar el profeId
      selfId: user.id
    });
    convList.innerHTML = `<div class="item active">Tu profesor</div>`;
  } else {
    profeId = user.username;
    const res = await fetch('/api/alumnos?profeId=' + encodeURIComponent(profeId));
    const alumnos = await res.json();

    convList.innerHTML = '';
    alumnos.forEach(al => {
      const item = document.createElement('div');
      item.className = 'item';
      item.dataset.username = al.username;
      item.innerHTML = `<span>${al.name || al.username}</span>`;
      item.onclick = () => selectAlumno(al.username, item);
      convList.appendChild(item);
    });

    if (alumnos[0]) selectAlumno(alumnos[0].username, convList.firstChild);
  }
})();

async function cargarHistorial(alumnoId, profeId) {
  try {
    thread.innerHTML = '';
    const res = await fetch(`/api/messages/${alumnoId}/${profeId}`);
    const history = await res.json();

    history.forEach(msg => {
      addMessage({
        from: msg.user_id,
        text: msg.content,
        ts: new Date(msg.created_at).getTime(),
        kind: 'chat'
      });
    });
  } catch (err) {
    console.error("❌ Error cargando historial:", err);
  }
}

async function selectAlumno(alumnoUsername, itemEl) {
  [...convList.children].forEach(c => c.classList.remove('active'));
  itemEl.classList.add('active');
  currentAlumnoId = alumnoUsername;
  await cargarHistorial(alumnoUsername, profeId);

  socket.emit('join', {
    role: 'profesor',
    alumnoId: alumnoUsername,
    profeId,
    selfId: user.id
  });
}
socket.off('message');
// --- Escuchar mensajes en tiempo real ---
socket.on('message', (msg) => {
  // Evitar duplicados
  if (msg.tempId && document.querySelector(`[data-tempid="${msg.tempId}"]`)) return;

  addMessage({
    from: msg.user_id || msg.from,
    text: msg.text || msg.content,
    ts: msg.ts || Date.now(),
    kind: 'chat'
  });
});

// --- Sensor data ---
socket.on("sensorData", (data) => {
  // Dashboard
  document.getElementById("heartRate").innerHTML = `${data.bpm.toFixed(1)} <span style="font-size:0.6em;color:#666;">BPM</span>`;
  document.getElementById("temperature").innerHTML = `${data.temperatura.toFixed(1)} <span style="font-size:0.6em;color:#666;">°C</span>`;
  document.getElementById("irValue").textContent = data.ir;
  document.getElementById("accX").textContent = data.movimiento.toFixed(2);
  document.getElementById("moodValue").textContent = data.estadoEmocional;

  const moodCard = document.getElementById("moodValue").parentElement;
  switch (data.estadoEmocional) {
    case "Calma 😌": moodCard.style.background = "#a8e6cf"; break;
    case "Estrés 😰": moodCard.style.background = "#ff8b94"; break;
    case "Fatiga 😴": moodCard.style.background = "#d3cde6"; break;
    case "Excitación 😃": moodCard.style.background = "#ffd3b6"; break;
    case "Ansiedad 😟": moodCard.style.background = "#ffaaa5"; break;
    case "Sin Dedo": moodCard.style.background = "#cccccc"; break;
    default: moodCard.style.background = "#ffffff";
  }

  // Cambiar fondo del item del alumno
  const alumnoItem = [...convList.children].find(item => {
    return item.dataset.username === data.alumnoId;
  });

  if (alumnoItem.dataset.username) {
    switch (data.estadoAlumno) { // 0=verde, 1=amarillo, 2=rojo
      case 0: alumnoItem.style.backgroundColor = '#a8e6cf'; break; // verde claro
      case 1: alumnoItem.style.backgroundColor = '#ffd3b6'; break; // amarillo claro
      case 2: alumnoItem.style.backgroundColor = '#ff8b94'; break; // rojo claro
      default: alumnoItem.style.backgroundColor = '#cccccc'; // gris
    }
  }
  console.log(data.estadoAlumno)
console.log(alumnoItem.dataset.username)
});

// --- Enviar mensaje ---
window.sendMsg = function () {
  const input = document.getElementById('msg');
  const text = input.value.trim();
  if (!text) return;

  const tempId = 'local-' + Date.now();

  // Mostrar solo localmente (optimista)
  addMessage({
    from: user.id,
    text,
    ts: Date.now(),
    kind: 'chat',
    tempId
  });

  // Enviar al servidor
  socket.emit('message', { 
    text, 
    alumnoId: currentAlumnoId, 
    tempId,
    from: user.id
  });

  input.value = '';
};
