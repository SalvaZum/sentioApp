
// app.js
const user = JSON.parse(localStorage.getItem('user') || 'null');
if (!user) location.href = '/';

const urlParams = new URLSearchParams(location.search);
const role = urlParams.get('role') || user.role;

const socket = io();
const thread = document.getElementById('thread');
const convList = document.getElementById('convList');

let currentAlumnoId = null; // 👈 ahora será el *username* del alumno
let profeId = null;         // 👈 será el *username* del profe

//Crea apartado para datos ESP 32
const divEsp = document.getElementById('sensor-data');
const chat = document.querySelector('.chat');
if (role === 'alumno') {
  divEsp.remove();
  chat.style.width = '100%';
} else {
  chat.style.width = '70%';
  
}

const chatHistory = {}; // { alumnoUsername: [ msg, ... ] }

function addMessage({ from, text, ts, kind, data }) {
  const el = document.createElement('div');
  el.className = 'msg' + ((from === user.id) ? ' me' : '') + (kind === 'esp' ? ' esp' : '');
  if (kind === 'esp') {
    el.innerHTML = `<div class="meta">Datos ESP (${new Date(ts).toLocaleTimeString()}):</div>
    <pre style="margin:0">${JSON.stringify(data, null, 2)}</pre>`;
  } else {
    el.innerHTML = `<div>${text}</div><div class="meta">${new Date(ts).toLocaleTimeString()}</div>`;
  }
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

function logout() {
  localStorage.removeItem('user');
  location.href = '/';
}

(async function init() {
  if (role === 'alumno') {
    // 🔑 usa username del alumno para la sala
    const alumnoUsername = user.username;
    currentAlumnoId = alumnoUsername;

    // deja que el server resuelva el profe con el mapeo
    socket.emit('join', { role: 'alumno', alumnoId: alumnoUsername, profeId: null, selfId: user.id });
    convList.innerHTML = `<div class="item active">Tu profesor</div>`;
  } else { // profesor
    profeId = user.username; // 🔑 username del profe
    const res = await fetch('/api/alumnos?profeId=' + encodeURIComponent(profeId));
    const alumnos = await res.json();

    convList.innerHTML = '';
    alumnos.forEach(al => {
      const item = document.createElement('div');
      item.className = 'item';
      item.textContent = `${al.name || al.username}`;
      // 🔑 al.id es UUID, para salas necesitamos al.username
      item.onclick = () => selectAlumno(al.username, item);
      convList.appendChild(item);
    });

    if (alumnos[0]) selectAlumno(alumnos[0].username, convList.firstChild);
  }
})();

// 🔹 Nueva función para traer historial desde Supabase
async function cargarHistorial(alumnoId, profeId) {
  try {
    thread.innerHTML = ''; // limpiar pantalla
    const res = await fetch(`/api/messages/${alumnoId}/${profeId}`);
    const history = await res.json();

    history.forEach(msg => {
      addMessage({
        from: msg.user_id,
        text: msg.content,
        ts: new Date(msg.created_at).getTime(),
        kind: 'chat',
        alumnoId,
        profeId
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

  // 🔹 usar función reutilizable
  await cargarHistorial(alumnoUsername, profeId);

  socket.emit('join', { role: 'profesor', alumnoId: alumnoUsername, profeId, selfId: user.id });
}

socket.on('system', txt => {
  if (txt.includes('se unió al chat')) return;
  addMessage({ from: 'sistema', text: txt, ts: Date.now(), kind: 'chat' });
});

// Mensajes de chat
socket.off('message');
socket.on('message', msg => {
  // Guardar siempre en historial del alumno
  if (role === 'profesor') {
    if (!chatHistory[msg.alumnoId]) chatHistory[msg.alumnoId] = [];
    chatHistory[msg.alumnoId].push(msg);

    // Mostrar solo si es el chat actualmente abierto
    if (msg.alumnoId !== currentAlumnoId) return;
  }
  addMessage(msg);
});


socket.off('esp-data');
socket.on('esp-data', payload => {
  if (role === 'profesor' && payload.alumnoId !== currentAlumnoId) return;
  addMessage(payload);
});


window.sendMsg = function () {
  const input = document.getElementById('msg');
  const text = input.value.trim();
  if (!text) return;

  // profesor: currentAlumnoId es el alumno seleccionado (username)
  // alumno: currentAlumnoId = su propio username
  socket.emit('message', { text, alumnoId: currentAlumnoId });
  input.value = '';
};
