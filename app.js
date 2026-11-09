import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// SUAS CREDENCIAIS DO FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBoqyE_A9cAJl2uyBioXNBB8JF94BnStj4",
  authDomain: "meu-diario-app-b8bfd.firebaseapp.com",
  projectId: "meu-diario-app-b8bfd",
  storageBucket: "meu-diario-app-b8bfd.firebasestorage.app",
  messagingSenderId: "376407447383",
  appId: "1:376407447383:web:e41345dad532bbebf2d012"
};

// SUA CHAVE DA API GEMINI
const GEMINI_API_KEY = "AQ.Ab8RN6K34LRRHh_lEUh7a9yP9xYeH9C9O8grqZV1AtlTu8eyJQ";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let recordedAudioBlob = null;
let currentLocation = null;
let chatHistory = [];

const btnRecord = document.getElementById('btnRecord');
const statusMsg = document.getElementById('statusMsg');
const btnSave = document.getElementById('btnSave');
const btnLocation = document.getElementById('btnLocation');

// 1. CHAT COM A IA (GEMINI API)
async function chamarGemini(prompt) {
  if (!GEMINI_API_KEY) return "Erro: Chave da API Gemini não configurada.";
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error(err);
    return "Erro ao comunicar com a IA.";
  }
}

// 2. TRANSCRIÇÃO DE ÁUDIO VIA GEMINI API
async function transcreverAudioGemini(blob) {
  statusMsg.innerText = "IA transcrevendo áudio gravado...";
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const base64Audio = reader.result.split(',')[1];
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "Transcreva este áudio em Português com clareza e pontuação adequada:" },
                { inline_data: { mime_type: "audio/mp3", data: base64Audio } }
              ]
            }]
          })
        });
        const data = await response.json();
        const textoTranscrito = data.candidates[0].content.parts[0].text;
        resolve(textoTranscrito);
      } catch (e) {
        console.error(e);
        resolve("[Erro na transcrição automática do áudio]");
      }
    };
  });
}

// LÓGICA DO CHAT DE IA
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
    const entryText = document.getElementById('entryText');
    entryText.value += `\n\n--- Conversa com IA ---\n` + chatHistory.join('\n');
    statusMsg.innerText = "Conversa com IA copiada para a nova entrada!";
  });
}

// 3. GRAVAÇÃO DE VOZ
if (btnRecord) {
  btnRecord.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          recordedAudioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
          statusMsg.innerText = "Áudio gravado com sucesso! Clique em 'Salvar Entrada' para transcrever.";
        };

        mediaRecorder.start();
        isRecording = true;
        btnRecord.classList.add('recording');
        btnRecord.innerText = "⏹️ Parar Gravação";
        statusMsg.innerText = "Gravando áudio... Clique em Parar ao terminar.";
      } catch (err) {
        alert("Erro ao acessar o microfone. Verifique as permissões do navegador.");
      }
    } else {
      mediaRecorder.stop();
      isRecording = false;
      btnRecord.classList.remove('recording');
      btnRecord.innerText = "🎙️ Gravar Voz";
    }
  });
}

// 4. CAPTURA DE LOCALIZAÇÃO GPS
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

// 5. SALVAR REGISTRO NO FIREBASE (COM TRANSCRIÇÃO)
if (btnSave) {
  btnSave.addEventListener('click', async () => {
    let textoFinal = document.getElementById('entryText').value;
    const photo = document.getElementById('photoInput').files[0];
    let photoBase64 = null;

    if (!textoFinal && !photo && !recordedAudioBlob) {
      alert("Escreva algo, selecione uma foto ou grave um áudio antes de salvar.");
      return;
    }

    btnSave.disabled = true;
    statusMsg.innerText = "Processando e salvando registro...";

    // Transcrever o áudio gravado se houver
    if (recordedAudioBlob) {
      const transcricao = await transcreverAudioGemini(recordedAudioBlob);
      textoFinal += `\n\n🎙️ [Transcrição de Voz]:\n${transcricao}`;
    }

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

      statusMsg.innerText = "Entrada salva e transcrita com sucesso!";
      document.getElementById('entryText').value = "";
      recordedAudioBlob = null;
      currentLocation = null;
    } catch (err) {
      console.error(err);
      statusMsg.innerText = "Erro ao salvar. Verifique as Regras do Firestore.";
    } finally {
      btnSave.disabled = false;
    }
  });
}

// 6. ESCUTAR EM TEMPO REAL
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
