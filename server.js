require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

if (!process.env.FIREBASE_KEY) {
  console.error('❌ Debes poner FIREBASE_KEY="./firebase-key.json" en .env');
  process.exit(1);
}

const serviceAccount = require(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const Usuarios = db.collection('usuarios');
const Messages = db.collection('mensajes');

console.log('✅ Firebase conectado');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function roomOf(a, p) { return `room:${a}:${p}`; }

// ======================
// LOGIN
// ======================
app.post('/api/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const snap = await Usuarios
      .where('email', '==', email)
      .where('username', '==', username)
      .where('password', '==', password)
      .get();

    if (snap.empty) return res.status(401).json({ error: 'Credenciales inválidas' });

    const doc = snap.docs[0];
    res.json({ id: doc.id, ...doc.data() });

  } catch (err) {
    console.error("❌ Error login:", err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ======================
// LISTA ALUMNOS
// ======================
app.get('/api/alumnos', async (req, res) => {
  try {
    const profeId = req.query.profeId;
    if (!profeId) return res.status(400).json({ error: 'Falta profeId' });

    const snap = await Usuarios
      .where('role', '==', 'alumno')
      .where('profeId', '==', profeId)
      .get();

    let alumnos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    console.log('Alumnos recibidos (server):', alumnos);

    res.json(alumnos);

  } catch (err) {
    console.error("❌ Error alumnos:", err);
    res.status(500).json({ error: 'Error consultando alumnos' });
  }
});

// ======================
// HISTORIAL
// ======================
app.get('/api/messages/:alumnoId/:profeId', async (req, res) => {
  try {
    const { alumnoId, profeId } = req.params;
    const snap = await Messages
      .where('alumno_id', '==', alumnoId)
      .where('profe_id', '==', profeId)
      .orderBy('ts')
      .get();

    const history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(history);

  } catch (err) {
    console.error("🔥 Error historial:", err);
    res.status(500).json({ error: 'Error cargando historial' });
  }
});

// ======================
// MQTT
// ======================
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://10.42.0.1";
const client = mqtt.connect(MQTT_BROKER);

client.on('connect', () => {
  console.log('📡 MQTT conectado');
  client.subscribe('sensor/alumnos/+/datos');
});

client.on('message', (topic, message) => {
  try {
    const raw = message.toString().trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return;

    const payload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    const alumnoId = topic.split('/')[2];

    // 🔹 Enviar todos los datos
    const data = {
      alumnoId,
      bpm: Number(payload.bpm || 0),
      ir: Number(payload.ir || 0),
      temperatura: Number(payload.temperatura || 0),
      movimiento: Number(payload.movimiento || 0),
      estadoAlumno: Number(payload.estado || 0),
      rmssd: Number(payload.rmssd || 0),
      accX: Number(payload.accX || 0),
      accY: Number(payload.accY || 0),
      accZ: Number(payload.accZ || 0),
      gyroX: Number(payload.gyroX || 0),
      gyroY: Number(payload.gyroY || 0),
      gyroZ: Number(payload.gyroZ || 0)
    };

    io.emit('sensorData', data);

  } catch (err) {
    console.error("❌ Error MQTT:", err);
  }
});

// ======================
// SOCKET.IO
// ======================
io.on('connection', (socket) => {
  console.log("🟢 Conectado", socket.id);

  socket.on('join', ({ role, alumnoId, profeId, selfId }) => {
    if (role === 'alumno') socket.join(roomOf(alumnoId, profeId));
    if (role === 'profesor') {
      socket.join(`room:profesor:${profeId}`);
      if (alumnoId) socket.join(roomOf(alumnoId, profeId));
    }
    socket.data = { role, alumnoId, profeId, selfId };
  });

  socket.on('message', async ({ text, alumnoId, tempId, from }) => {
    try {
      const realAlumno = alumnoId || socket.data.alumnoId;
      const realProfe = socket.data.profeId;

      const payload = {
        user_id: from,
        from,
        content: text,
        text,
        ts: Date.now(),
        alumnoId: realAlumno,
        profeId: realProfe,
        tempId
      };

      await Messages.add({
        user_id: from,
        alumno_id: realAlumno,
        profe_id: realProfe,
        content: text,
        ts: payload.ts,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });

      io.to(roomOf(realAlumno, realProfe)).emit('message', payload);

    } catch (err) {
      console.error("❌ Error mensaje:", err);
    }
  });
});

server.listen(PORT, () => console.log(`🚀 Servidor iniciado en http://localhost:${PORT}`));
