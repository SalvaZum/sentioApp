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

function selectAlumno(alumnoUsername, itemEl) {
  [...convList.children].forEach(c => c.classList.remove('active'));
  itemEl.classList.add('active');

  currentAlumnoId = alumnoUsername;
  thread.innerHTML = '';

  if (chatHistory[alumnoUsername]) {
    chatHistory[alumnoUsername].forEach(msg => addMessage(msg));
  }

  // el profe se une a la sala privada del alumno seleccionado
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

//Sensores

let heartRateChart, mentalStatesChart;
        let heartRateData = [];
        let mentalStatesData = {
            stress: [],
            concentration: [],
            distraction: [],
            anxiety: []
        };
        const maxDataPoints = 20;
        let serialReader = null;

        function initCharts() {
            // Gráfico de ritmo cardíaco
            const heartCtx = document.getElementById('heartRateChart').getContext('2d');
            heartRateChart = new Chart(heartCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Ritmo Cardíaco (BPM)',
                        data: heartRateData,
                        borderColor: '#ff4757',
                        backgroundColor: 'rgba(255, 71, 87, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    animation: {
                        duration: 1000
                    }
                }
            });

            // Gráfico de estados mentales
            const mentalCtx = document.getElementById('mentalStatesChart').getContext('2d');
            mentalStatesChart = new Chart(mentalCtx, {
                type: 'radar',
                data: {
                    labels: ['Concentración', 'Desconcentración', 'Estrés', 'Ansiedad'],
                    datasets: [{
                        label: 'Estado Actual',
                        data: [0, 0, 0, 0],
                        backgroundColor: 'rgba(102, 126, 234, 0.2)',
                        borderColor: 'rgba(102, 126, 234, 1)',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        r: {
                            beginAtZero: true,
                            max: 100,
                            ticks: {
                                stepSize: 20
                            }
                        }
                    }
                }
            });
        }

        // Función para calcular estados mentales basados en datos de sensores
        function calculateMentalStates(data) {
            // Estos cálculos son ejemplos simplificados
            // En una aplicación real, se usarían algoritmos más complejos
            
            // Concentración: HR estable + movimiento bajo
            let hrStability = 100 - Math.abs(data.hr - 75); // Asumiendo 75 como óptimo
            let movement = Math.sqrt(data.gx*data.gx + data.gy*data.gy + data.gz*data.gz);
            
            let concentration = Math.max(0, Math.min(100, hrStability * 0.7 + (5 - movement) * 6));
            
            // Desconcentración: inverso de la concentración
            let distraction = 100 - concentration;
            
            // Estrés: HR alta + movimiento elevado
            let stress = Math.max(0, Math.min(100, 
                (Math.max(0, data.hr - 60) / 60 * 100) * 0.6 + 
                (Math.min(5, movement) / 5 * 100) * 0.4
            ));
            
            // Ansiedad: HR alta + alta variabilidad de movimiento
            let anxiety = Math.max(0, Math.min(100, 
                (Math.max(0, data.hr - 70) / 50 * 100) * 0.5 +
                (Math.min(2, Math.sqrt(data.ax*data.ax + data.ay*data.ay + data.az*data.az)) / 2 * 100) * 0.5
            ));
            
            return {
                concentration: Math.round(concentration),
                distraction: Math.round(distraction),
                stress: Math.round(stress),
                anxiety: Math.round(anxiety)
            };
        }

        function updateDisplay(data) {
            // Actualizar última actualización
            document.getElementById('lastUpdate').textContent = 
                `Última actualización: ${new Date().toLocaleTimeString()}`;

            // Actualizar valores principales
            document.getElementById('heartRate').textContent = data.hr + ' BPM';
            document.getElementById('temperature').textContent = data.temp.toFixed(1) + ' °C';
            document.getElementById('irValue').textContent = data.ir;

            // Calcular estados mentales
            const mentalStates = calculateMentalStates(data);
            
            // Actualizar estados mentales
            document.getElementById('concentrationValue').textContent = mentalStates.concentration + '%';
            document.getElementById('distractionValue').textContent = mentalStates.distraction + '%';
            document.getElementById('stressValue').textContent = mentalStates.stress + '%';
            document.getElementById('anxietyValue').textContent = mentalStates.anxiety + '%';

            // Actualizar barras de progreso
            document.getElementById('concentrationBar').style.width = mentalStates.concentration + '%';
            document.getElementById('distractionBar').style.width = mentalStates.distraction + '%';
            document.getElementById('stressBar').style.width = mentalStates.stress + '%';
            document.getElementById('anxietyBar').style.width = mentalStates.anxiety + '%';

            // Actualizar sensores
            document.getElementById('accX').textContent = Number(data.ax).toFixed(2);
            document.getElementById('accY').textContent = Number(data.ay).toFixed(2);
            document.getElementById('accZ').textContent = Number(data.az).toFixed(2);
            document.getElementById('gyroX').textContent = Number(data.gx).toFixed(2);
            document.getElementById('gyroY').textContent = Number(data.gy).toFixed(2);
            document.getElementById('gyroZ').textContent = Number(data.gz).toFixed(2);
            console.log('Data.ax =', Number(data.ax))
            // Manejar alerta de dedo
            const noFingerAlert = document.getElementById('noFingerAlert');
            if (data.ir < 50000) {
                noFingerAlert.style.display = 'block';
            } else {
                noFingerAlert.style.display = 'none';
                updateCharts(data, mentalStates);
            }
        }

        function updateCharts(data, mentalStates) {
            // Actualizar gráfico de ritmo cardíaco
            heartRateData.push(data.hr);
            if (heartRateData.length > maxDataPoints) heartRateData.shift();
            
            const labels = Array.from({length: heartRateData.length}, (_, i) => {
                const now = new Date();
                now.setSeconds(now.getSeconds() - (heartRateData.length - i - 1));
                return now.toLocaleTimeString();
            });

            heartRateChart.data.labels = labels;
            heartRateChart.data.datasets[0].data = heartRateData;
            heartRateChart.update('none');

            // Actualizar gráfico de estados mentales
            mentalStatesChart.data.datasets[0].data = [
                mentalStates.concentration,
                mentalStates.distraction,
                mentalStates.stress,
                mentalStates.anxiety
            ];
            mentalStatesChart.update('none');
        }

        function updateConnectionStatus(connected) {
            const status = document.getElementById('connectionStatus');
            if (connected) {
                status.textContent = 'Conectado';
                status.className = 'connection-status connected';
            } else {
                status.textContent = 'Desconectado';
                status.className = 'connection-status disconnected';
            }
        }

        // Función para conectar con el puerto serial (Web Serial API)
        async function connectSerial() {
            try {
                if (!('serial' in navigator)) {
                    alert('Web Serial API no es compatible con tu navegador. Usa Chrome o Edge.');
                    return;
                }

                // Solicitar puerto serial
                const port = await navigator.serial.requestPort();
                await port.open({ baudRate: 115200 });

                updateConnectionStatus(true);

                const decoder = new TextDecoder();
                let buffer = '';

                // Leer datos del puerto serial
                while (port.readable) {
                    const reader = port.readable.getReader();
                    try {
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value);
                            const lines = buffer.split('\n');

                            // Procesar todas las líneas completas
                            for (let i = 0; i < lines.length - 1; i++) {
                                const line = lines[i].trim();
                                if (line.startsWith('HR:') && line.includes('Acc:')) {
                                    processSensorData(line);
                                }
                            }

                            // Guardar la línea incompleta para la siguiente iteración
                            buffer = lines[lines.length - 1];
                        }
                    } catch (error) {
                        console.error('Error reading serial data:', error);
                        updateConnectionStatus(false);
                    } finally {
                        reader.releaseLock();
                    }
                }
            } catch (error) {
                console.error('Error connecting to serial port:', error);
                updateConnectionStatus(false);
            }
        }

        // Función para procesar los datos del sensor desde el formato de texto
        function processSensorData(line) {
            try {
                // Extraer datos usando expresiones regulares
                const hrMatch = line.match(/HR: (\d+)/);
                const irMatch = line.match(/IR: (\d+)/);
                const tempMatch = line.match(/Temp: ([\d.]+)/);
                const accMatch = line.match(/Acc: ([\d.-]+), ([\d.-]+), ([\d.-]+)/);
                const gyroMatch = line.match(/Giro: ([\d.-]+), ([\d.-]+), ([\d.-]+)/);

                if (hrMatch && irMatch && tempMatch && accMatch && gyroMatch) {
                    const sensorData = {
                        hr: parseInt(hrMatch[1]),
                        ir: parseInt(irMatch[1]),
                        temp: parseFloat(tempMatch[1]),
                        ax: parseFloat(accMatch[1]),
                        ay: parseFloat(accMatch[2]),
                        az: parseFloat(accMatch[3]),
                        gx: parseFloat(gyroMatch[1]),
                        gy: parseFloat(gyroMatch[2]),
                        gz: parseFloat(gyroMatch[3])
                    };

                    updateDisplay(sensorData);
                }
            } catch (error) {
                console.error('Error processing sensor data:', error);
            }
        }

        // Inicializar la aplicación
        document.addEventListener('DOMContentLoaded', function() {
            initCharts();            
        });