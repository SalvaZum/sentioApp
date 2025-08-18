const user = JSON.parse(localStorage.getItem('user') || 'null');
if (!user) location.href = '/';

const urlParams = new URLSearchParams(location.search);
const role = urlParams.get('role') || user.role;

const socket = io();
const thread = document.getElementById('thread');
const convList = document.getElementById('convList');
const title = document.getElementById('title');

let currentAlumnoId = null; 
let profeId = null;

// 🔹 Historial local por alumno (solo en navegador del profe)
const chatHistory = {}; // { alumnoId: [ mensajes ] }

// render helpers
function addMessage({ from, text, ts, kind, data }) {
  const el = document.createElement('div');
  el.className = 'msg' + ((from === user.id) ? ' me' : '') + (kind==='esp' ? ' esp' : '');
  if (kind === 'esp') {
    el.innerHTML = `<div class="meta">Datos ESP (${new Date(ts).toLocaleTimeString()}):</div>
    <pre style="margin:0">${JSON.stringify(data, null, 2)}</pre>`;
  } else {
    el.innerHTML = `<div>${text}</div><div class="meta">${from} • ${new Date(ts).toLocaleTimeString()}</div>`;
  }
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;

  // 🔹 Guardar en historial si es profe y tiene alumno activo
  if (role === 'profesor' && currentAlumnoId) {
    if (!chatHistory[currentAlumnoId]) chatHistory[currentAlumnoId] = [];
    chatHistory[currentAlumnoId].push({ from, text, ts, kind, data });
  }
}

function logout() {
  localStorage.removeItem('user');
  location.href = '/';
}

// inicialización por rol
(async function init() {
  if (role === 'alumno') {
    const alumnoId = user.id;
    profeId = null;
    title.textContent = `Chat con tu profesor`;
    currentAlumnoId = alumnoId;
    socket.emit('join', { role: 'alumno', alumnoId, profeId: 'pr1', selfId: user.id });
    convList.innerHTML = `<div class="item active">Tu profesor</div>`;
  } else { // profesor
    profeId = user.id;
    title.textContent = `Profesor: ${user.name}`;
    const res = await fetch('/api/alumnos?profeId=' + profeId);
    const alumnos = await res.json();
    convList.innerHTML = '';
    alumnos.forEach(al => {
      const item = document.createElement('div');
      item.className = 'item';
      item.textContent = `${al.name} (${al.id})`;
      item.onclick = () => selectAlumno(al.id, item);
      convList.appendChild(item);
    });
    if (alumnos[0]) selectAlumno(alumnos[0].id, convList.firstChild);
  }
})();

function selectAlumno(alumnoId, itemEl) {
  // marcar activo
  [...convList.children].forEach(c => c.classList.remove('active'));
  itemEl.classList.add('active');

  currentAlumnoId = alumnoId;

  // limpiar hilo
  thread.innerHTML = '';

  // 🔹 Restaurar historial si existe
  if (chatHistory[alumnoId]) {
    chatHistory[alumnoId].forEach(msg => addMessage(msg));
  }

  // unirse a sala específica
  socket.emit('join', { role: 'profesor', alumnoId, profeId, selfId: user.id });
  title.textContent = `Chat con ${alumnoId}`;
}

// eventos socket
socket.on('system', txt => {
    if (txt.includes("se unió al chat")) return; // 👈 se filtra
  addMessage({ from: 'sistema', text: txt, ts: Date.now(), kind: 'chat' });
});
socket.on('message', msg => addMessage(msg));
socket.on('esp-data', payload => addMessage(payload));

// enviar mensaje
window.sendMsg = function() {
  const input = document.getElementById('msg');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('message', { text });
  input.value = '';
  
};

// Escuchar datos de la ESP32
socket.on("sensorData", (data) => {
  if (currentChat === data.alumnoId) {
    document.getElementById("sensor-data").innerHTML = `
      <h3>Datos del alumno (${data.alumnoId})</h3>
      <div class="sensor-row"><span>Estado de ánimo:</span><strong>${data.mood}</strong></div>
      <div class="sensor-row"><span>Frecuencia cardíaca:</span><strong>${data.hr} bpm</strong></div>
      <div class="sensor-row"><span>Temperatura:</span><strong>${data.temp} °C</strong></div>
      <div class="sensor-row"><span>Pasos:</span><strong>${data.steps}</strong></div>
    `;
  }
});
