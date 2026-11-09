import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoqyE_A9cAJl2uyBioXNBB8JF94BnStj4",
  authDomain: "meu-diario-app-b8bfd.firebaseapp.com",
  projectId: "meu-diario-app-b8bfd",
  storageBucket: "meu-diario-app-b8bfd.firebasestorage.app",
  messagingSenderId: "376407447383",
  appId: "1:376407447383:web:e41345dad532bbebf2d012"
};

const GEMINI_API_KEY = "AIzaSyBoqyE_A9cAJl2uyBioXNBB8JF94BnStj4"; 

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentLocation = null;
let chatHistory = [];
let mediaStream = null;
let recognition = null;
let isRecording = false;

const btnRecord = document.getElementById('btnRecord');
const statusMsg = document.getElementById('statusMsg');
const btnSave = document.getElementById('btnSave');
const btnLocation = document.getElementById('btnLocation');
const entryText = document.getElementById('entryText');

// 1. CONVERSA COM A IA (GEMINI API)
async function chamarGemini(prompt) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error(err);
    return "Erro ao comunicar com a IA.";
  }
}

// CHAT DE IA
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const btnSendChat = document.getElementById('btnSendChat');
const btnInspire = document.getElementById('btnInspire');
const btnSaveChatToDiary = document.getElementById('btnSaveChatToDiary');

function appendMsg(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${sender === 'user' ? 'msg-user' : 'msg-ai'}`;
  msgDiv.innerText = text;
  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
  chatHistory.push(`${sender === 'user' ? 'Você' : 'IA'}: ${text}`);
}

if (btnSendChat) {
  btnSendChat.addEventListener('click', async () => {
    const text = chatInput.value.trim();
    if (!text) return;
    appendMsg('user', text);
    chatInput.value = '';
    const respostaIA = await chamarGemini(`Você é um assistente pessoal empático de diário. Responda brevemente e ajude o usuário a refletir sobre o seu dia: ${text}`);
    appendMsg('ai', respostaIA);
  });
}

if (btnInspire) {
  btnInspire.addEventListener('click', async () => {
    appendMsg('ai', "Pensando em uma pergunta de reflexão...");
    const pergunta = await chamarGemini("Gere 2 perguntas reflexivas, curtas e interessantes para ajudar alguém a escrever no seu diário pessoal hoje.");
    appendMsg('ai', pergunta);
  });
}

if (btnSaveChatToDiary) {
  btnSaveChatToDiary.addEventListener('click', () => {
    if (chatHistory.length === 0) return;
    entryText.value += `\n\n--- Conversa com IA ---\n` + chatHistory.join('\n');
    statusMsg.innerText = "Conversa copiada para o diário!";
  });
}

// 2. DITADO NATIVO EM TEMPO REAL E DESLIGAMENTO DE MICROFONE
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function desligarMicrofoneHardware() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
      track.enabled = false;
    });
    mediaStream = null;
  }
}

async function alternarGravacao() {
  if (!isRecording) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert("Permissão de microfone negada ou indisponível.");
      return;
    }

    if (!SpeechRecognition) {
      alert("Seu navegador não suporta ditado nativo. Abra no Google Chrome ou Microsoft Edge.");
      desligarMicrofoneHardware();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-BR';

    recognition.onresult = (event) => {
      let textoTranscrito = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        textoTranscrito += event.results[i][0].transcript;
      }
      if (textoTranscrito && entryText) {
        entryText.value += (entryText.value ? ' ' : '') + textoTranscrito.trim();
      }
    };

    recognition.onerror = (e) => {
      console.error("Erro no ditado:", e);
    };

    recognition.start();
    isRecording = true;
    btnRecord.classList.add('recording');
    btnRecord.innerText = "⏹️ Parar Gravação";
    statusMsg.innerText = "🎙️ Fale agora! O texto será inserido automaticamente...";

  } else {
    isRecording = false;
    btnRecord.classList.remove('recording');
    btnRecord.innerText = "🎙️ Gravar Voz";

    if (recognition) {
      recognition.stop();
      recognition = null;
    }

    desligarMicrofoneHardware();
    statusMsg.innerText = "Gravação encerrada e microfone desligado com sucesso!";
  }
}

if (btnRecord) {
  btnRecord.addEventListener('click', alternarGravacao);
}

// 3. CAPTURA DE LOCALIZAÇÃO GPS
if (btnLocation) {
  btnLocation.addEventListener('click', () => {
    if (navigator.geolocation) {
      statusMsg.innerText = "Obtendo localização...";
      navigator.geolocation.getCurrentPosition(pos => {
        currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        statusMsg.innerText = `Local salvo: ${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`;
      }, () => statusMsg.innerText = "Erro ao obter GPS.");
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

// 4. SALVAR REGISTRO NO FIREBASE
if (btnSave) {
  btnSave.addEventListener('click', async () => {
    let textoFinal = entryText.value;
    const photo = document.getElementById('photoInput').files[0];
    let photoBase64 = null;

    if (!textoFinal && !photo) {
      alert("Escreva algo ou grave um áudio antes de salvar.");
      return;
    }

    if (isRecording) {
      await alternarGravacao();
    }

    btnSave.disabled = true;
    statusMsg.innerText = "Salvando registro no banco de dados...";

    if (photo) {
      photoBase64 = await fileToBase64(photo);
    }

    try {
      await addDoc(collection(db, "diario_entradas"), {
        texto: textoFinal,
        data: new Date().toISOString(),
        localizacao: currentLocation,
        fotoBase64: photoBase64
      });

      statusMsg.innerText = "Entrada salva com sucesso!";
      entryText.value = "";
      currentLocation = null;
    } catch (err) {
      console.error(err);
      statusMsg.innerText = "Erro ao salvar no banco de dados.";
    } finally {
      btnSave.disabled = false;
    }
  });
}

// 5. HISTÓRICO EM TEMPO REAL
function escutarEntradasEmTempoReal() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;

  const q = query(collection(db, "diario_entradas"), orderBy("data", "desc"));
  
  onSnapshot(q, (querySnapshot) => {
    timeline.innerHTML = "";
    if (querySnapshot.empty) {
      timeline.innerHTML = "<p>Nenhuma entrada salva ainda.</p>";
      return;
    }

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const dateFormatted = new Date(data.data).toLocaleString('pt-BR');
      
      let html = `
        <div style="border-left:4px solid #2563eb; padding-left:12px; margin-bottom:15px;">
          <div style="font-size:12px; color:#64748b; font-weight:bold;">${dateFormatted} ${data.localizacao ? '📍' : ''}</div>
          <p style="white-space: pre-wrap; margin: 6px 0;">${data.texto}</p>
          ${data.fotoBase64 ? `<img src="${data.fotoBase64}" style="max-width:100%; border-radius:8px; margin-top:6px;">` : ''}
        </div>
      `;
      timeline.innerHTML += html;
    });
  }, (error) => {
    console.error(error);
    timeline.innerHTML = "<p>Erro ao carregar o histórico.</p>";
  });
}

escutarEntradasEmTempoReal();
