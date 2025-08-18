// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Config ---
const PORT = process.env.PORT || 3000;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost';

// --- DEMO "DB" en memoria ---
const users = [
  { id: 'al1', name: 'Ana Alumna', role: 'alumno', password: '1234' },
  { id: 'al2', name: 'Benito Alumno', role: 'alumno', password: '1234' },
  { id: 'pr1', name: 'Prof. Perez', role: 'profesor', password: '1234' },
];

const alumnoToProfe = {
  al1: 'pr1',
  al2: 'pr1',
};

function roomOf(alumnoId, profeId) {
  return `room:${alumnoId}:${profeId}`;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- LOGIN ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const found = users.find(u => u.id === username && u.password === password);
  if (!found) return res.status(401).json({ error: 'Credenciales inválidas' });
  res.json({ id: found.id, name: found.name, role: found.role });
});

// --- LISTA ALUMNOS ---
app.get('/api/alumnos', (req, res) => {
  const { profeId } = req.query;
  if (!profeId) return res.status(400).json({ error: 'profeId requerido' });
  const lista = Object.entries(alumnoToProfe)
    .filter(([alId, prId]) => prId === profeId)
    .map(([alId]) => users.find(u => u.id === alId));
  res.json(lista || []);
});

// --- CHAT ---
io.on('connection', socket => {
  socket.on('join', ({ role, alumnoId, profeId, selfId }) => {
    try {
      if (role === 'alumno') {
        const asignado = alumnoToProfe[alumnoId];
        if (!asignado || asignado !== profeId) return;
        socket.join(roomOf(alumnoId, profeId));
      } else if (role === 'profesor') {
        socket.join(roomOf(alumnoId, profeId));
      }
      socket.data = { role, alumnoId, profeId, selfId };
      io.to(roomOf(alumnoId, profeId)).emit('system', `${selfId} se unió al chat`);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('message', ({ text }) => {
    const { alumnoId, profeId, selfId } = socket.data || {};
    if (!alumnoId || !profeId) return;
    const payload = { from: selfId, text, ts: Date.now(), kind: 'chat' };
    io.to(roomOf(alumnoId, profeId)).emit('message', payload);
  });
});

// --- MQTT ---
const mqttClient = mqtt.connect("mqtt://192.168.50.1:1883");

mqttClient.on("connect", () => {
  console.log("Conectado al broker MQTT");
  mqttClient.subscribe("esp32/+/datos"); // 👈 ahora acepta cualquier alumno
});

// --- Función para predecir estado de ánimo ---
function predecirEstado(data) {
  const { hr, temp, steps } = data;

  if (!hr || !temp) return "Indefinido";

  if (hr > 100 && steps < 50) return "Ansioso";
  if (hr < 60 && steps < 30) return "Relajado";
  if (steps > 500) return "Activo";
  if (temp > 37.5) return "Cansado/Febril";

  return "Normal";
}

mqttClient.on("message", (topic, msgBuf) => {
  try {
    // topic: esp32/<alumnoId>/datos
    const [, alumnoId] = topic.split('/');
    const profeId = alumnoToProfe[alumnoId];
    if (!profeId) return;

    const data = JSON.parse(msgBuf.toString());

    // 👇 añadimos el estado de ánimo
    const mood = predecirEstado(data);

    const payload = {
      kind: 'esp',
      alumnoId,
      data,
      mood, // 👈 nuevo campo
      ts: Date.now(),
    };

    io.to(roomOf(alumnoId, profeId)).emit('esp-data', payload);
  } catch (e) {
    console.error('[MQTT] mensaje inválido', topic, e);
  }
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});

