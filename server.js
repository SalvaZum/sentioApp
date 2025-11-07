require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

// --- CONEXIÓN MONGODB ---
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// --- MODELOS ---
const UsuarioSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  name: String,
  role: String,
  profeId: String
});

const MessageSchema = new mongoose.Schema({
  user_id: String,
  alumno_id: String,
  profe_id: String,
  content: String,
  created_at: { type: Date, default: Date.now }
});

const Usuario = mongoose.model('Usuario', UsuarioSchema);
const Message = mongoose.model('Message', MessageSchema);

// --- CONFIG SERVIDOR ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- Mapeo alumnos a profesores ---
const alumnoToProfe = { al1: 'pr1', al2: 'pr1', al3: 'pr1', al4: 'pr1' };
function roomOf(alumnoUsername, profeUsername) {
  return `room:${alumnoUsername}:${profeUsername}`;
}

// --- Middlewares ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- LOGIN ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const user = await Usuario.findOne({ email, username, password }).lean();

    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    res.json({
      id: user._id,
      username: user.username,
      name: user.name || user.username,
      role: user.role,
      profeId: user.profeId || null
    });
  } catch (err) {
    console.error('Error en /api/login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// --- LISTA DE ALUMNOS ---
app.get('/api/alumnos', async (req, res) => {
  try {
    const alumnos = await Usuario.find({ role: 'alumno' }, 'id username name role').lean();
    res.json(alumnos);
  } catch (err) {
    res.status(500).json({ error: 'Error consultando alumnos' });
  }
});

// --- HISTORIAL DE MENSAJES ---
app.get('/api/messages/:alumnoId/:profeId', async (req, res) => {
  try {
    const { alumnoId, profeId } = req.params;
    const mensajes = await Message.find({ alumno_id: alumnoId, profe_id: profeId })
      .sort({ created_at: 1 })
      .lean();
    res.json(mensajes);
  } catch (err) {
    res.status(500).json({ error: 'Error trayendo mensajes' });
  }
});

// --- MQTT ---
const MQTT_BROKER = "mqtt://10.42.0.1";
const client = mqtt.connect(MQTT_BROKER);

client.on("connect", () => {
  console.log("✅ Conectado al broker MQTT");
  client.subscribe("sensor/alumnos/+/datos");
});

function calcularEstadoEmocional(data) {
  const { bpm, rmssd, movimiento } = data;
  if (bpm === 0) return "Sin Dedo";
  if (rmssd > 35 && bpm >= 60 && bpm <= 90 && movimiento < 25) return "Calma 😌";
  if (rmssd < 25 && bpm > 95 && movimiento < 40) return "Estrés 😰";
  if (bpm < 60 && movimiento < 20 && rmssd > 30) return "Fatiga 😴";
  if (bpm > 100 && movimiento > 30 && rmssd > 25) return "Excitación 😃";
  if (rmssd < 20 || (movimiento > 50 && bpm > 90)) return "Ansiedad 😟";
  return "Neutro 😐";
}

client.on("message", (topic, message) => {
  try {
    let raw = message.toString().trim().replace(/[^\x20-\x7E]+/g, "");
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return;

    const payload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    const data = {
      alumnoId: topic.split('/')[2],
      bpm: parseFloat(payload.bpm || 0),
      ir: parseInt(payload.ir || 0),
      movimiento: parseFloat(payload.movimiento || 0),
      temperatura: parseFloat(payload.temperatura || 0),
      rmssd: parseFloat(payload.rmssd || 0),
      estadoAlumno: parseFloat(payload.estado || 0),
    };
    data.estadoEmocional = calcularEstadoEmocional(data);
    io.emit("sensorData", data);
  } catch (err) {
    console.error("❌ Error procesando MQTT:", err);
  }
});

// --- SOCKET.IO ---
io.on('connection', socket => {
  console.log('🟢 Nuevo socket conectado', socket.id);

  socket.on('join', ({ role, alumnoId, profeId, selfId }) => {
    if (socket.data?.role === 'alumno') socket.leave(roomOf(socket.data.alumnoId, socket.data.profeId));
    if (socket.data?.role === 'profesor') {
      socket.leave(`room:profesor:${socket.data.profeId}`);
      if (socket.data?.alumnoId) socket.leave(roomOf(socket.data.alumnoId, socket.data.profeId));
    }

    if (role === 'alumno') {
      const asignado = alumnoToProfe[alumnoId];
      if (!asignado) return;
      profeId = asignado;
      socket.join(roomOf(alumnoId, profeId));
    } else if (role === 'profesor') {
      socket.join(`room:profesor:${profeId}`);
      if (alumnoId) socket.join(roomOf(alumnoId, profeId));
    }

    socket.data = { role, alumnoId, profeId, selfId };
  });

  socket.on('message', async ({ text, alumnoId: alumnoIdParam, tempId }) => {
    try {
      const role = socket.data?.role;
      let alumnoId = socket.data?.alumnoId;
      let profeId = socket.data?.profeId;

      if (role === 'profesor') alumnoId = alumnoIdParam || alumnoId;
      if (role === 'alumno') profeId = alumnoToProfe[alumnoId];
      if (!alumnoId || !profeId) return;

      const payload = { from: socket.data.selfId, text, ts: Date.now(), alumnoId, profeId, tempId };

      await Message.create({
        user_id: socket.data.selfId,
        alumno_id: alumnoId,
        profe_id: profeId,
        content: text
      });

      io.to(roomOf(alumnoId, profeId)).emit('message', payload);

    } catch (err) {
      console.error("❌ Error enviando mensaje:", err);
    }
  });

  socket.on('disconnect', () => console.log('🔴 Socket desconectado', socket.id));
});

server.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));
