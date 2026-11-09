import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoqyE_A9cAJl2uyBioXNBB8JF94BnStj4",
  authDomain: "meu-diario-app-b8bfd.firebaseapp.com",
  projectId: "meu-diario-app-b8bfd",
  storageBucket: "meu-diario-app-b8bfd.firebasestorage.app",
  messagingSenderId: "376407447383",
  appId: "1:376407447383:web:e41345dad532bbebf2d012"
};

// Crie uma chave NOVA só para o Gemini (restrita ao seu domínio) e cole aqui.
const GEMINI_API_KEY = "COLE_AQUI_SUA_NOVA_CHAVE_DO_GEMINI";
// gemini-1.5-flash foi descontinuado; troque aqui se quiser outro modelo.
const GEMINI_MODEL = "gemini-2.5-flash";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentLocation = null;
let chatHistory = [];
let mediaStream = null;
let recognition = null;
let isRecording = false;
let baseText = "";

const btnRecord = document.getElementById('btnRecord');
const statusMsg = document.getElementById('statusMsg');
const btnSave = document.getElementById('btnSave');
const btnLocation = document.getElementById('btnLocation');
const entryText = document.getElementById('entryText');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 1. CONVERSA COM A IA (GEMINI API)
async function chamarGemini(prompt) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    const data = await response.json();
    if (!response.ok || data.error) {
      console.error("Erro Gemini:", data.error || response.status);
      return `Erro da IA: ${data.error?.message || response.status}`;
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "A IA não retornou resposta.";
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

// 2. DITADO NATIVO EM TEMPO REAL + DESLIGAMENTO FÍSICO DO MICROFONE
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

function finalizarUI() {
  recognition = null;
  isRecording = false;
  desligarMicrofoneHardware();
  btnRecord.classList.remove('recording');
  btnRecord.innerText = "🎙️ Gravar Voz";
}

function criarReconhecimento() {
  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'pt-BR';

  rec.onresult = (event) => {
    let finais = '';
    let parciais = '';
    for (let i = 0; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) finais += t;
      else parciais += t;
    }
    const ditado = (finais + parciais).trim();
    entryText.value = baseText + (baseText && ditado ? ' ' : '') + ditado;
    entryText.scrollTop = entryText.scrollHeight;
  };

  rec.onerror = (e) => {
    console.error("Erro no ditado:", e.error);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      alert("Permissão de microfone negada ou indisponível.");
      finalizarUI();
      statusMsg.innerText = "Microfone indisponível.";
    }
    // 'no-speech' e 'aborted' são normais; o onend cuida do resto.
  };

  rec.onend = () => {
    // O Chrome encerra sozinho após silêncio: reinicia se o usuário ainda quer gravar.
    if (isRecording) {
      baseText = entryText.value;
      try {
        recognition = criarReconhecimento();
        recognition.start();
        return;
      } catch (err) {
        console.error(err);
      }
    }
    finalizarUI();
  };

  return rec;
}

async function iniciarGravacao() {
  if (!SpeechRecognition) {
    alert("Seu navegador não suporta ditado nativo. Abra no Google Chrome ou Microsoft Edge.");
    return;
  }

  // Só para pedir permissão; o stream é encerrado logo em seguida
  // (manter aberto junto com o reconhecimento falha em alguns celulares).
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    desligarMicrofoneHardware();
  } catch (err) {
    alert("Permissão de microfone negada ou indisponível.");
    return;
  }

  baseText = entryText.value;
  recognition = criarReconhecimento();
  isRecording = true;

  try {
    recognition.start();
  } catch (err) {
    console.error(err);
    finalizarUI();
    return;
  }

  btnRecord.classList.add('recording');
  btnRecord.innerText = "⏹️ Parar Gravação";
  statusMsg.innerText = "🎙️ Fale agora! O texto será inserido automaticamente...";
}

function pararGravacao() {
  return new Promise((resolve) => {
    isRecording = false;
    if (!recognition) {
      finalizarUI();
      resolve();
      return;
    }
    const rec = recognition;
    const timer = setTimeout(() => { finalizarUI(); resolve(); }, 1500);
    rec.onend = () => {
      clearTimeout(timer);
      finalizarUI();
      resolve();
    };
    try {
      rec.stop();
    } catch (err) {
      clearTimeout(timer);
      finalizarUI();
      resolve();
    }
  }).then(() => {
    statusMsg.innerText = "Gravação encerrada e microfone desligado com sucesso!";
  });
}

async function alternarGravacao() {
  if (!isRecording) await iniciarGravacao();
  else await pararGravacao();
}

if (btnRecord) {
  btnRecord.addEventListener('click', alternarGravacao);
}

// Garante que o microfone apague se a página for fechada/escondida
window.addEventListener('pagehide', () => {
  isRecording = false;
  try { recognition?.abort(); } catch (e) {}
  desligarMicrofoneHardware();
});

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

// Reduz a foto para caber no limite de ~1 MB por documento do Firestore
function comprimirImagem(file, maxLado = 1024, qualidade = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 4. SALVAR REGISTRO NO FIREBASE
if (btnSave) {
  btnSave.addEventListener('click', async () => {
    const photo = document.getElementById('photoInput').files[0];
    let photoBase64 = null;

    if (isRecording) {
      await pararGravacao(); // espera o último trecho ditado chegar
    }

    const textoFinal = entryText.value.trim();

    if (!textoFinal && !photo) {
      alert("Escreva algo ou grave um áudio antes de salvar.");
      return;
    }

    btnSave.disabled = true;
    statusMsg.innerText = "Salvando registro no banco de dados...";

    try {
      if (photo) {
        photoBase64 = await comprimirImagem(photo);
      }

      await addDoc(collection(db, "diario_entradas"), {
        texto: textoFinal,
        data: new Date().toISOString(),
        localizacao: currentLocation,
        fotoBase64: photoBase64
      });

      statusMsg.innerText = "Entrada salva com sucesso!";
      entryText.value = "";
      baseText = "";
      currentLocation = null;
      document.getElementById('photoInput').value = "";
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
    if (querySnapshot.empty) {
      timeline.innerHTML = "<p>Nenhuma entrada salva ainda.</p>";
      return;
    }

    let html = "";
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const dateFormatted = new Date(data.data).toLocaleString('pt-BR');
      const foto = typeof data.fotoBase64 === 'string' && data.fotoBase64.startsWith('data:image/')
        ? `<img src="${data.fotoBase64}" style="max-width:100%; border-radius:8px; margin-top:6px;">`
        : '';

      html += `
        <div style="border-left:4px solid #2563eb; padding-left:12px; margin-bottom:15px;">
          <div style="font-size:12px; color:#64748b; font-weight:bold;">${escapeHtml(dateFormatted)} ${data.localizacao ? '📍' : ''}</div>
          <p style="white-space: pre-wrap; margin: 6px 0;">${escapeHtml(data.texto)}</p>
          ${foto}
        </div>
      `;
    });
    timeline.innerHTML = html;
  }, (error) => {
    console.error(error);
    timeline.innerHTML = "<p>Erro ao carregar o histórico.</p>";
  });
}

escutarEntradasEmTempoReal();
