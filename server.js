// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require('body-parser')

const supabaseUrl = 'https://kfkzhppfrygsafgapxiw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtma3pocHBmcnlnc2FmZ2FweGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5ODE4MDYsImV4cCI6MjA3MTU1NzgwNn0.-Wirpd6kHGFIocqM9VmMDOBGNlV6ckmagcJCftV_txM';
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 🔑 Mapeo por *username* (no por id UUID de Supabase)
const alumnoToProfe = { al1: 'pr1', al2: 'pr1', al3: 'pr1', al4:'pr1' };

function roomOf(alumnoUsername, profeUsername) {
  return `room:${alumnoUsername}:${profeUsername}`;
}

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- LOGIN (Supabase) ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .eq('username', username)
      .eq('password', password) // ⚠️ en producción no uses texto plano
      .single();

    if (error || !data) {
      console.error('Login error:', error?.message);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Guarda lo que el front usará: username para salas, id por si quieres mostrar autoría
    res.json({
      id: data.id,
      username: data.username,
      name: data.name || data.username,
      role: data.role,
    });
  } catch (err) {
    console.error('Error en /api/login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// --- LISTA TODOS LOS ALUMNOS ---
app.get('/api/alumnos', async (req, res) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, username, name, role')
    .eq('role', 'alumno');

  if (error) {
    console.error('Error consultando alumnos:', error.message);
    return res.status(500).json({ error: 'Error consultando alumnos' });
  }

  res.json(data || []);
});

app.get('/api/messages/:alumnoId/:profeId', async (req, res) => {
  const { alumnoId, profeId } = req.params;

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('alumno_id', alumnoId)
    .eq('profe_id', profeId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error("❌ Error trayendo mensajes:", error.message);
    return res.status(500).json({ error: "Error trayendo mensajes" });
  }

  res.json(data);
});



// --- SOCKET.IO CHAT ---
io.on('connection', socket => {
  console.log('🟢 Nuevo socket', socket.id);

  socket.on('join', ({ role, alumnoId, profeId, selfId }) => {
    try {
      // salir de salas previas
      if (socket.data?.role === 'alumno') {
        socket.leave(roomOf(socket.data.alumnoId, socket.data.profeId));
      } else if (socket.data?.role === 'profesor') {
        socket.leave(`room:profesor:${socket.data.profeId}`);
        if (socket.data?.alumnoId) socket.leave(roomOf(socket.data.alumnoId, socket.data.profeId));
      }

      if (role === 'alumno') {
        const asignado = alumnoToProfe[alumnoId];
        if (!asignado) return;
        profeId = asignado;
        socket.join(roomOf(alumnoId, profeId)); // sala privada
      } else if (role === 'profesor') {
        profeId = profeId || socket.data?.profeId; // asegurar que profeId esté definido
        socket.join(`room:profesor:${profeId}`);   // 🔹 sala global del profe
        if (alumnoId) socket.join(roomOf(alumnoId, profeId)); // sala privada alumno seleccionado
      }

      socket.data = { role, alumnoId, profeId, selfId };
    } catch (e) {
      console.error('join error:', e);
    }
  });

  socket.on('message', async ({ text, alumnoId: alumnoIdParam }) => {
  try {
    const role = socket.data?.role;
    let alumnoId = socket.data?.alumnoId;
    let profeId = socket.data?.profeId;

    if (role === 'profesor') alumnoId = alumnoIdParam || alumnoId;
    else if (role === 'alumno') profeId = alumnoToProfe[alumnoId];

    if (!alumnoId || !profeId) return;

    const payload = {
      from: socket.data?.selfId,
      text,
      ts: Date.now(),
      kind: 'chat',
      alumnoId,
      profeId
    };

    // 🔹 Guardar en Supabase
    const { error } = await supabase
    .from('messages')
    .insert([
      {
        user_id: socket.data?.selfId,
        alumno_id: alumnoId,
        profe_id: profeId,
        content: text
      }
    ]);

    if (error) console.error("❌ Error guardando mensaje:", error);

    // 🔹 Emitir por Socket.IO como ya hacías
    io.to(roomOf(alumnoId, profeId)).emit('message', payload);

    if (role === 'alumno') {
      const profSockets = Array.from(io.sockets.adapter.rooms.get(`room:profesor:${profeId}`) || []);
      const privateRoomSockets = new Set(io.sockets.adapter.rooms.get(roomOf(alumnoId, profeId)) || []);

      profSockets.forEach(sid => {
        if (!privateRoomSockets.has(sid)) {
          io.to(sid).emit('message', payload);
        }
      });
    }
  } catch (e) {
    console.error('error enviando mensaje', e);
  }
});



  socket.on('disconnect', () => {
    console.log('🔴 Socket desconectado', socket.id);
  });
});

// --- MQTT opcional (igual que lo tenías) ---
const mqttClient = mqtt.connect('mqtt://192.168.50.1:1883');
mqttClient.on('connect', () => {
  console.log('Conectado al broker MQTT');
  mqttClient.subscribe('esp32/+/datos');
});
function predecirEstado(data) {
  const { hr, temp, steps } = data;
  if (!hr || !temp) return 'Indefinido';
  if (hr > 100 && steps < 50) return 'Ansioso';
  if (hr < 60 && steps < 30) return 'Relajado';
  if (steps > 500) return 'Activo';
  if (temp > 37.5) return 'Cansado/Febril';
  return 'Normal';
}
mqttClient.on('message', (topic, msgBuf) => {
  try {
    const [, alumnoUsername] = topic.split('/');
    const profeUsername = alumnoToProfe[alumnoUsername];
    if (!profeUsername) return;

    const data = JSON.parse(msgBuf.toString());
    const mood = predecirEstado(data);

    const payload = {
      kind: 'esp',
      alumnoId: alumnoUsername,
      data,
      mood,
      ts: Date.now(),
    };

    io.to(roomOf(alumnoUsername, profeUsername)).emit('esp-data', payload);
  } catch (e) {
    console.error('[MQTT] mensaje inválido', topic, e);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});
