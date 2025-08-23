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

//Crea apartado para datos ESP 32
const divEsp = document.getElementById('sensor-data')
const chat = document.querySelector('.chat')
if(role==='alumno'){
  divEsp.remove()
  chat.style.width='100%'
}else{
  chat.style.width='70%'
}

// Historial por alumno (solo profe)
const chatHistory = {}; // { alumnoId: [ msg, ... ] }

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
}

function logout() {
  localStorage.removeItem('user');
  location.href = '/';
}

(async function init() {
  if (role === 'alumno') {
    const alumnoId = user.id;
    currentAlumnoId = alumnoId;
    // el profe real se valida en servidor con alumnoToProfe
    socket.emit('join', { role: 'alumno', alumnoId, profeId: 'pr1', selfId: user.id });
    convList.innerHTML = `<div class="item active">Tu profesor</div>`;
  } else { // profesor
    profeId = user.id;
    const res = await fetch('/api/alumnos?profeId=' + profeId);
    const alumnos = await res.json();
    convList.innerHTML = '';
    alumnos.forEach(al => {
      const item = document.createElement('div');
      item.className = 'item';
      item.textContent = `${al.name}`;
      item.onclick = () => selectAlumno(al.id, item);
      convList.appendChild(item);
    });
    if (alumnos[0]) selectAlumno(alumnos[0].id, convList.firstChild);
  }
})();

function selectAlumno(alumnoId, itemEl) {
  [...convList.children].forEach(c => c.classList.remove('active'));
  itemEl.classList.add('active');

  currentAlumnoId = alumnoId;
  thread.innerHTML = '';

  // Restaurar historial
  if (chatHistory[alumnoId]) {
    chatHistory[alumnoId].forEach(msg => addMessage(msg));
  }

  // Unirse a sala específica (actualiza socket.data en el servidor)
  socket.emit('join', { role: 'profesor', alumnoId, profeId, selfId: user.id });
 
}

// SYSTEM (si lo envías; en tu server está comentado)
socket.on('system', txt => {
  if (txt.includes("se unió al chat")) return;
  addMessage({ from: 'sistema', text: txt, ts: Date.now(), kind: 'chat' });
});

// MENSAJES DE CHAT (ARREGLO: manejar por alumnoId)
socket.on('message', msg => {
  if (role === 'profesor') {
    // guardar SIEMPRE en historial del alumno correspondiente
    if (!chatHistory[msg.alumnoId]) chatHistory[msg.alumnoId] = [];
    chatHistory[msg.alumnoId].push(msg);

    // mostrar solo si es el chat actualmente abierto
    if (msg.alumnoId !== currentAlumnoId) return;
  }
  addMessage(msg);
});

// DATOS ESP
socket.on('esp-data', payload => {
  // los datos van a la sala correcta; si estás en otro chat no los mostrás
  if (role === 'profesor' && payload.alumnoId !== currentAlumnoId) return;
  addMessage(payload);
});

// Enviar mensaje
window.sendMsg = function() {
  const input = document.getElementById('msg');
  const text = input.value.trim();
  if (!text) return;

  // El profe DEBE enviar con el alumno actualmente seleccionado
  // El alumno envía con su propio id (currentAlumnoId = user.id)
  socket.emit('message', { text, alumnoId: currentAlumnoId });
  input.value = '';
};
