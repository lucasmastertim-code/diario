import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoqyE_A9cAJl2uyBioXNBB8JF94BnStj4",
  authDomain: "meu-diario-app-b8bfd.firebaseapp.com",
  projectId: "meu-diario-app-b8bfd",
  storageBucket: "meu-diario-app-b8bfd.firebasestorage.app",
  messagingSenderId: "376407447383",
  appId: "1:376407447383:web:e41345dad532bbebf2d012"
};

// Chave do Google AI Studio, só para o Gemini (pública no código, por decisão do dono).
const GEMINI_API_KEY = "AQ.Ab8RN6K6jZY78LvOKQiH9wdrB7qRGZWP3W6mvUZhzBnVwzKsAA";
// gemini-1.5-flash foi descontinuado; troque aqui se quiser outro modelo.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MODELOS = [GEMINI_MODEL, "gemini-flash-latest"]; // tenta o próximo se um modelo não existir

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentLocation = null;
let chatHistory = [];
let mediaStream = null;
let recognition = null;
let isRecording = false;
let baseText = "";
let alvoDitado = null;   // campo que recebe o texto ditado
let botaoDitado = null;  // botão que iniciou o ditado
let btnMicChat = null;   // microfone do chat com a IA
let ultimoErroDitado = null;
let ultimoTrechoAndroid = "";

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const providerGoogle = new GoogleAuthProvider();
providerGoogle.addScope(DRIVE_SCOPE);
let driveToken = null;
let driveTokenHora = 0;
let pastaDriveId = null;
let fotosPendentes = [];
let arquivosPendentes = [];

const APP_VERSION = "v10-busca";
console.log("app.js", APP_VERSION);

const btnRecord = document.getElementById('btnRecord');
const statusMsg = document.getElementById('statusMsg');
const btnSave = document.getElementById('btnSave');
const btnLocation = document.getElementById('btnLocation');
const entryText = document.getElementById('entryText');
if (statusMsg) statusMsg.innerText = `app.js ${APP_VERSION}`;

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
  let ultimoErro = "Erro ao comunicar com a IA.";
  for (const modelo of GEMINI_MODELOS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      const data = await response.json();
      if (!response.ok || data.error) {
        console.error("Erro Gemini:", modelo, data.error || response.status);
        ultimoErro = `Erro da IA (${modelo}): ${(data.error && data.error.message) || response.status}`;
        if (response.status === 404) continue; // modelo indisponível: tenta o próximo
        return ultimoErro;
      }
      const texto = data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
        && data.candidates[0].content.parts[0].text;
      return texto || "A IA não retornou resposta.";
    } catch (err) {
      console.error(err);
      return "Erro ao comunicar com a IA.";
    }
  }
  return ultimoErro;
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
    if (isRecording && alvoDitado === chatInput) await pararGravacao();
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
const EH_ANDROID = /Android/i.test(navigator.userAgent);

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
  if (btnMicChat) {
    btnMicChat.classList.remove('recording');
    btnMicChat.innerText = "🎙️";
    btnMicChat.style.background = '';
    btnMicChat.style.color = '';
  }
  alvoDitado = null;
  botaoDitado = null;
}

function criarReconhecimento() {
  const rec = new SpeechRecognition();
  rec.continuous = !EH_ANDROID; // no Android, o modo contínuo repete o texto
  rec.interimResults = !EH_ANDROID; // no Android, só resultados finais (evita repetição)
  rec.lang = 'pt-BR';

  rec.onresult = (event) => {
    let ditado = '';

    if (EH_ANDROID) {
      // Android: modo não contínuo, cada sessão devolve uma frase.
      // Usamos só o ÚLTIMO resultado (ignora os acumulados repetidos)
      // e, quando ele fica final, "travamos" o texto em baseText.
      const ultimo = event.results[event.results.length - 1];
      const t = ultimo[0].transcript.trim();
      if (!t || !ultimo.isFinal) return;
      if (t === ultimoTrechoAndroid) return; // ignora evento repetido idêntico
      ultimoTrechoAndroid = t;
      const campoA = alvoDitado || entryText;
      baseText = baseText + (baseText ? ' ' : '') + t;
      campoA.value = baseText;
      campoA.scrollTop = campoA.scrollHeight;
      return;
    } else {
      let finais = '';
      let parciais = '';
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finais += t;
        else parciais += t;
      }
      ditado = (finais + parciais).trim();
    }

    const campo = alvoDitado || entryText;
    campo.value = baseText + (baseText && ditado ? ' ' : '') + ditado;
    campo.scrollTop = campo.scrollHeight;
  };

  rec.onerror = (e) => {
    console.error("Erro no ditado:", e.error, e.message);
    // 'no-speech' e 'aborted' são normais; o onend cuida do resto.
    if (e.error === 'no-speech' || e.error === 'aborted') return;

    const explicacoes = {
      'not-allowed': 'Permissão de microfone negada. Libere o microfone nas configurações do site.',
      'service-not-allowed': 'O navegador bloqueou o serviço de voz. Abra no Chrome (fora do app instalado) e permita o microfone.',
      'network': 'Sem acesso ao serviço de voz do Google. Verifique a internet; Edge/Brave/VPN costumam causar isso. Tente no Chrome.',
      'audio-capture': 'Nenhum microfone encontrado ou ele está em uso por outro programa.',
      'language-not-supported': 'Idioma pt-BR não suportado neste navegador.'
    };

    ultimoErroDitado = e.error;
    isRecording = false; // evita o reinício automático em loop
    statusMsg.innerText = `⚠️ Erro no ditado (${e.error}): ${explicacoes[e.error] || 'erro desconhecido.'}`;
    try { rec.abort(); } catch (err) {}
    finalizarUI();
  };

  rec.onend = () => {
    // O Chrome encerra sozinho após silêncio: reinicia se o usuário ainda quer gravar.
    if (isRecording) {
      baseText = (alvoDitado || entryText).value;
      ultimoTrechoAndroid = "";
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

async function iniciarGravacao(alvo, botao) {
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

  alvoDitado = alvo || entryText;
  botaoDitado = botao || btnRecord;
  baseText = alvoDitado.value;
  ultimoErroDitado = null;
  recognition = criarReconhecimento();
  isRecording = true;

  try {
    recognition.start();
  } catch (err) {
    console.error(err);
    finalizarUI();
    return;
  }

  const botaoAtivo = botaoDitado || btnRecord;
  botaoAtivo.classList.add('recording');
  if (botaoAtivo === btnRecord) {
    botaoAtivo.innerText = "⏹️ Parar Gravação";
  } else {
    botaoAtivo.innerText = "⏹️";
    botaoAtivo.style.background = '#fee2e2';
    botaoAtivo.style.color = '#b91c1c';
  }
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
    if (!ultimoErroDitado) {
      statusMsg.innerText = "Gravação encerrada e microfone desligado com sucesso!";
    }
  });
}

async function alternarGravacao(alvo, botao) {
  if (isRecording) {
    const mesmoBotao = (botao || btnRecord) === botaoDitado;
    await pararGravacao();
    if (mesmoBotao) return;
  }
  await iniciarGravacao(alvo, botao);
}

if (btnRecord) {
  btnRecord.addEventListener('click', () => alternarGravacao(entryText, btnRecord));
}

// Microfone também no chat com a IA
if (chatInput && btnSendChat) {
  btnMicChat = document.createElement('button');
  btnMicChat.type = 'button';
  btnMicChat.className = btnSendChat.className;
  btnMicChat.innerText = '🎙️';
  btnMicChat.title = 'Falar com a IA';
  btnMicChat.addEventListener('click', () => alternarGravacao(chatInput, btnMicChat));
  btnSendChat.insertAdjacentElement('beforebegin', btnMicChat);
}

// Garante que o microfone apague se a página for fechada/escondida
window.addEventListener('pagehide', () => {
  isRecording = false;
  try { recognition?.abort(); } catch (e) {}
  desligarMicrofoneHardware();
});

// 3. LOCAL, CLIMA, LUA E MAPA (como no Journey)
let climaAtual = null;
let contextoSolicitado = false;

async function nomeDoLugar(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=pt-BR&lat=${lat}&lon=${lng}`);
    if (!r.ok) return null;
    const d = await r.json();
    const a = d.address || {};
    const rua = a.road || a.pedestrian || a.footway || '';
    const bairro = a.suburb || a.neighbourhood || a.quarter || '';
    const cidade = a.city || a.town || a.village || a.municipality || '';
    const partes = [rua, bairro, cidade, a.state].filter(Boolean);
    return partes.length ? partes.join(', ') : (d.display_name || null);
  } catch (err) {
    console.error(err);
    return null;
  }
}

function descreverClima(codigo, ehDia) {
  const t = {
    0: ['Céu limpo', ehDia ? '☀️' : '🌙'],
    1: ['Predominantemente limpo', ehDia ? '🌤️' : '🌙'],
    2: ['Parcialmente nublado', '⛅'],
    3: ['Nublado', '☁️'],
    45: ['Neblina', '🌫️'], 48: ['Neblina com geada', '🌫️'],
    51: ['Garoa leve', '🌦️'], 53: ['Garoa', '🌦️'], 55: ['Garoa forte', '🌧️'],
    56: ['Garoa congelante', '🌧️'], 57: ['Garoa congelante forte', '🌧️'],
    61: ['Chuva leve', '🌧️'], 63: ['Chuva', '🌧️'], 65: ['Chuva forte', '🌧️'],
    66: ['Chuva congelante', '🌧️'], 67: ['Chuva congelante forte', '🌧️'],
    71: ['Neve leve', '❄️'], 73: ['Neve', '❄️'], 75: ['Neve forte', '❄️'], 77: ['Grãos de neve', '❄️'],
    80: ['Pancadas de chuva leves', '🌦️'], 81: ['Pancadas de chuva', '🌧️'], 82: ['Pancadas de chuva fortes', '⛈️'],
    85: ['Pancadas de neve', '❄️'], 86: ['Pancadas de neve fortes', '❄️'],
    95: ['Trovoada', '⛈️'], 96: ['Trovoada com granizo', '⛈️'], 99: ['Trovoada com granizo forte', '⛈️']
  };
  const par = t[codigo] || ['Tempo indefinido', '🌡️'];
  return { descricao: par[0], icone: par[1] };
}

async function buscarClima(lat, lng) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day&timezone=auto`);
    if (!r.ok) return null;
    const d = await r.json();
    const c = d.current;
    if (!c) return null;
    const desc = descreverClima(c.weather_code, c.is_day === 1);
    return {
      temp: Math.round(c.temperature_2m),
      sensacao: Math.round(c.apparent_temperature),
      umidade: c.relative_humidity_2m,
      codigo: c.weather_code,
      descricao: desc.descricao,
      icone: desc.icone
    };
  } catch (err) {
    console.error(err);
    return null;
  }
}

function faseDaLua(data) {
  const sinodico = 29.530588853;
  const base = Date.UTC(2000, 0, 6, 18, 14);
  let idade = ((data.getTime() - base) / 86400000) % sinodico;
  if (idade < 0) idade += sinodico;
  const fases = [
    ['Lua nova', '🌑'], ['Lua crescente', '🌒'], ['Quarto crescente', '🌓'], ['Crescente gibosa', '🌔'],
    ['Lua cheia', '🌕'], ['Minguante gibosa', '🌖'], ['Quarto minguante', '🌗'], ['Lua minguante', '🌘']
  ];
  const i = Math.floor((idade / sinodico) * 8 + 0.5) % 8;
  return { nome: fases[i][0], icone: fases[i][1] };
}

function urlMapa(lat, lng) {
  const dx = 0.004;
  const dy = 0.002;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - dx},${lat - dy},${lng + dx},${lat + dy}&layer=mapnik&marker=${lat},${lng}`;
}

// Caixa com o mapinha e o clima da entrada que está sendo escrita
const mapaBox = document.createElement('div');
mapaBox.style.cssText = 'display:none;margin:8px 0;padding:10px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;';
if (btnSave) btnSave.insertAdjacentElement('beforebegin', mapaBox);

function mostrarContexto() {
  mapaBox.innerHTML = '';
  if (!currentLocation) {
    mapaBox.style.display = 'none';
    return;
  }
  mapaBox.style.display = 'block';
  const rotulo = currentLocation.nome || `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`;
  const lua = faseDaLua(new Date());
  const info = document.createElement('div');
  info.style.cssText = 'font-size:13px;color:#334155;margin-bottom:8px;';
  let texto = `📍 ${rotulo}`;
  if (climaAtual) texto += ` · ${climaAtual.icone} ${climaAtual.temp}°C, ${climaAtual.descricao}`;
  texto += ` · ${lua.icone} ${lua.nome}`;
  info.textContent = texto;
  const mapa = document.createElement('iframe');
  mapa.src = urlMapa(currentLocation.lat, currentLocation.lng);
  mapa.title = 'Mapa';
  mapa.loading = 'lazy';
  mapa.style.cssText = 'width:100%;height:150px;border:0;border-radius:10px;';
  mapaBox.appendChild(info);
  mapaBox.appendChild(mapa);
}

function capturarContexto() {
  if (!navigator.geolocation) {
    statusMsg.innerText = "Este navegador não tem GPS.";
    return Promise.resolve();
  }
  statusMsg.innerText = "Obtendo localização...";
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      currentLocation = { lat, lng, nome: null };
      statusMsg.innerText = "Buscando o lugar e o clima...";
      const resultados = await Promise.all([nomeDoLugar(lat, lng), buscarClima(lat, lng)]);
      currentLocation.nome = resultados[0];
      climaAtual = resultados[1];
      mostrarContexto();
      statusMsg.innerText = "Local e clima registrados.";
      resolve();
    }, () => {
      statusMsg.innerText = "Não consegui obter o GPS. Permita o acesso à localização.";
      resolve();
    }, { enableHighAccuracy: true, timeout: 15000 });
  });
}

// Captura automática ao começar a escrever ou gravar (uma vez por entrada)
function capturarAutomatico() {
  if (contextoSolicitado || currentLocation) return;
  contextoSolicitado = true;
  capturarContexto();
}
if (entryText) entryText.addEventListener('focus', capturarAutomatico);
if (btnRecord) btnRecord.addEventListener('click', capturarAutomatico);

if (btnLocation) {
  btnLocation.addEventListener('click', () => {
    contextoSolicitado = true;
    capturarContexto();
  });
}

// 4. FOTOS E ARQUIVOS (a interface extra é criada por aqui mesmo)
const MAX_FOTOS = 4;
const MAX_ARQUIVO_MB = 10;
const photoInput = document.getElementById('photoInput');

const previewBox = document.createElement('div');
previewBox.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin:8px 0;';
if (btnSave) btnSave.insertAdjacentElement('beforebegin', previewBox);

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.multiple = true;
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// Entrada que abre a câmera direto no celular/tablet
const cameraInput = document.createElement('input');
cameraInput.type = 'file';
cameraInput.accept = 'image/*';
cameraInput.setAttribute('capture', 'environment');
cameraInput.style.display = 'none';
document.body.appendChild(cameraInput);

if (btnLocation) {
  const btnArquivo = document.createElement('button');
  btnArquivo.type = 'button';
  btnArquivo.className = btnLocation.className;
  btnArquivo.innerText = '📎 Arquivo';
  btnArquivo.addEventListener('click', () => fileInput.click());
  btnLocation.insertAdjacentElement('afterend', btnArquivo);

  const btnCamera = document.createElement('button');
  btnCamera.type = 'button';
  btnCamera.className = btnLocation.className;
  btnCamera.innerText = '📷 Câmera';
  btnCamera.addEventListener('click', () => cameraInput.click());
  btnLocation.insertAdjacentElement('afterend', btnCamera);
}

if (photoInput) {
  photoInput.multiple = true;
  photoInput.accept = 'image/*';
}

function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function botaoRemover(acao) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = '✕';
  b.style.cssText = 'position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:none;background:#ef4444;color:#fff;font-size:12px;cursor:pointer;padding:0;';
  b.addEventListener('click', acao);
  return b;
}

function renderPreview() {
  previewBox.innerHTML = '';
  fotosPendentes.forEach((f, i) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;';
    const img = document.createElement('img');
    const url = URL.createObjectURL(f);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    img.style.cssText = 'width:72px;height:72px;object-fit:cover;border-radius:8px;display:block;';
    wrap.appendChild(img);
    wrap.appendChild(botaoRemover(() => { fotosPendentes.splice(i, 1); renderPreview(); }));
    previewBox.appendChild(wrap);
  });
  arquivosPendentes.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.style.cssText = 'position:relative;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;background:#fff;max-width:100%;word-break:break-all;';
    chip.textContent = `📎 ${f.name} (${formatarTamanho(f.size)})`;
    chip.appendChild(botaoRemover(() => { arquivosPendentes.splice(i, 1); renderPreview(); }));
    previewBox.appendChild(chip);
  });
}

if (photoInput) {
  photoInput.addEventListener('change', () => {
    for (const f of Array.from(photoInput.files)) {
      if (!f.type.startsWith('image/')) continue;
      if (fotosPendentes.length >= MAX_FOTOS) {
        statusMsg.innerText = `Máximo de ${MAX_FOTOS} fotos por entrada.`;
        break;
      }
      fotosPendentes.push(f);
    }
    photoInput.value = '';
    renderPreview();
  });
}

cameraInput.addEventListener('change', () => {
  for (const f of Array.from(cameraInput.files)) {
    if (!f.type.startsWith('image/')) continue;
    if (fotosPendentes.length >= MAX_FOTOS) {
      statusMsg.innerText = `Máximo de ${MAX_FOTOS} fotos por entrada.`;
      break;
    }
    fotosPendentes.push(f);
  }
  cameraInput.value = '';
  renderPreview();
});

fileInput.addEventListener('change', () => {
  for (const f of Array.from(fileInput.files)) {
    if (f.size > MAX_ARQUIVO_MB * 1048576) {
      statusMsg.innerText = `"${f.name}" passa de ${MAX_ARQUIVO_MB} MB e foi ignorado.`;
      continue;
    }
    arquivosPendentes.push(f);
  }
  fileInput.value = '';
  renderPreview();
});

// Fotos ficam no próprio banco (reduzidas para caber no limite de ~1 MB)
function comprimirImagem(file, maxLado, qualidade) {
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

async function prepararFotos() {
  const tentativas = [[1024, 0.7], [800, 0.55], [600, 0.45]];
  for (const [lado, qualidade] of tentativas) {
    const lista = [];
    for (const f of fotosPendentes) lista.push(await comprimirImagem(f, lado, qualidade));
    const total = lista.reduce((soma, x) => soma + x.length, 0);
    if (total < 800000) return lista;
  }
  throw new Error('As fotos ficaram pesadas demais. Remova algumas.');
}

// Arquivos vão para a pasta "Meu Diário" no Google Drive da própria conta
function tokenDriveValido() {
  return driveToken && (Date.now() - driveTokenHora) < 50 * 60 * 1000;
}

async function entrarComGoogle() {
  const result = await signInWithPopup(auth, providerGoogle);
  const cred = GoogleAuthProvider.credentialFromResult(result);
  driveToken = cred && cred.accessToken ? cred.accessToken : null;
  driveTokenHora = Date.now();
  pastaDriveId = null;
}

async function driveFetch(url, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: { ...(opcoes.headers || {}), Authorization: `Bearer ${driveToken}` }
  });
  if (!r.ok) {
    let msg = String(r.status);
    try {
      const e = await r.json();
      msg = (e.error && e.error.message) || msg;
    } catch (x) {}
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function garantirPastaDrive() {
  if (pastaDriveId) return pastaDriveId;
  const q = encodeURIComponent("name='Meu Diário' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const lista = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
  if (lista.files && lista.files.length) {
    pastaDriveId = lista.files[0].id;
    return pastaDriveId;
  }
  const nova = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Meu Diário', mimeType: 'application/vnd.google-apps.folder' })
  });
  pastaDriveId = nova.id;
  return pastaDriveId;
}

async function enviarArquivoDrive(file, pastaId) {
  const limite = 'diario' + Date.now() + Math.random().toString(16).slice(2);
  const metadados = { name: file.name, parents: [pastaId] };
  const corpo = new Blob([
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadados)}\r\n`,
    `--${limite}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    file,
    `\r\n--${limite}--`
  ]);
  const r = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
    body: corpo
  });
  return { id: r.id, nome: r.name, tipo: r.mimeType, tamanho: Number(r.size) || file.size, link: r.webViewLink };
}

// SALVAR REGISTRO NO FIREBASE
if (btnSave) {
  btnSave.addEventListener('click', async () => {
    // O pop-up do Google precisa abrir logo no clique, antes de qualquer outra espera
    if (arquivosPendentes.length && !tokenDriveValido()) {
      try {
        statusMsg.innerText = "Conectando ao Google Drive...";
        await entrarComGoogle();
      } catch (err) {
        console.error(err);
        statusMsg.innerText = "Não foi possível conectar ao Google Drive. Permita pop-ups e o acesso ao Drive.";
        return;
      }
    }

    if (isRecording) await pararGravacao();

    const textoFinal = entryText.value.trim();
    if (!textoFinal && !fotosPendentes.length && !arquivosPendentes.length) {
      alert("Escreva algo, grave um áudio ou anexe algo antes de salvar.");
      return;
    }

    btnSave.disabled = true;
    try {
      statusMsg.innerText = "Preparando a entrada...";
      const fotos = await prepararFotos();

      const arquivos = [];
      if (arquivosPendentes.length) {
        const pastaId = await garantirPastaDrive();
        for (let i = 0; i < arquivosPendentes.length; i++) {
          statusMsg.innerText = `Enviando arquivo ${i + 1} de ${arquivosPendentes.length} para o Google Drive...`;
          arquivos.push(await enviarArquivoDrive(arquivosPendentes[i], pastaId));
        }
      }

      statusMsg.innerText = "Salvando registro no banco de dados...";
      await addDoc(collection(db, "diario_entradas"), {
        texto: textoFinal,
        uid: auth.currentUser ? auth.currentUser.uid : null,
        data: new Date().toISOString(),
        localizacao: currentLocation,
        clima: climaAtual,
        fotos,
        arquivos
      });

      statusMsg.innerText = "Entrada salva com sucesso!";
      entryText.value = "";
      baseText = "";
      currentLocation = null;
      climaAtual = null;
      contextoSolicitado = false;
      mostrarContexto();
      fotosPendentes = [];
      arquivosPendentes = [];
      renderPreview();
    } catch (err) {
      console.error(err);
      if (err.status === 401) driveToken = null;
      if (err.status === 404) pastaDriveId = null;
      let msg = err.message || 'tente de novo';
      if (err.status === 403 && /not been used|disabled|accessNotConfigured/i.test(msg)) {
        msg = 'a API do Google Drive não está ativada no projeto.';
      }
      statusMsg.innerText = `Erro ao salvar: ${msg}`;
    } finally {
      btnSave.disabled = false;
    }
  });
}

// 5. HISTÓRICO EM TEMPO REAL + BUSCA INTELIGENTE
let todasEntradas = [];
const busca = { consulta: '', modo: 'local', grupos: [], termosDestaque: [], extras: [] };

const STOPWORDS = new Set(['de','do','da','dos','das','no','na','nos','nas','que','eu','um','uma','uns','umas','em','com','para','por','meu','minha','meus','minhas','fiz','fui','foi','sobre','todos','todas','todo','toda','quero','ver','puxar','mostrar','mostra','mostre','relato','relatos','entrada','entradas','tudo','falei','escrevi','onde','quando','pra','pro','ou','seus','suas','tem','teve','tive']);

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Raiz simples para pegar variações (treino, treinei, treinar -> "trein")
function radical(p) {
  if (p.length >= 7) return p.slice(0, p.length - 2);
  if (p.length >= 5) return p.slice(0, p.length - 1);
  return p;
}

function palavrasDaConsulta(texto) {
  return norm(texto).split(/[^a-z0-9]+/).filter(p => p.length >= 3 && !STOPWORDS.has(p));
}

function textoBuscavel(e) {
  const partes = [e.texto];
  if (e.localizacao && e.localizacao.nome) partes.push(e.localizacao.nome);
  if (e.clima && e.clima.descricao) partes.push(e.clima.descricao);
  if (Array.isArray(e.arquivos)) e.arquivos.forEach(a => { if (a && a.nome) partes.push(a.nome); });
  return norm(partes.join(' \n '));
}

function definirBuscaLocal(consulta) {
  const palavras = palavrasDaConsulta(consulta);
  busca.consulta = consulta;
  busca.modo = 'local';
  busca.extras = [];
  busca.grupos = palavras.map(p => [radical(p)]); // todas as palavras precisam aparecer
  busca.termosDestaque = busca.grupos.map(g => g[0]);
}

// Devolve a pontuação (0 = não combina)
function entradaCombina(textoNorm) {
  if (!busca.grupos.length) return 1;
  let pontos = 0;
  for (const grupo of busca.grupos) {
    const achados = grupo.filter(t => textoNorm.includes(t));
    if (!achados.length) {
      if (busca.modo === 'local') return 0;
      continue;
    }
    pontos += achados.length;
  }
  return pontos;
}

function entradasFiltradas() {
  const lista = [];
  for (const e of todasEntradas) {
    const pontos = entradaCombina(textoBuscavel(e));
    if (pontos > 0) lista.push({ e, pontos });
  }
  if (busca.modo === 'ia') {
    lista.sort((a, b) => b.pontos - a.pontos || String(b.e.data).localeCompare(String(a.e.data)));
  }
  return lista;
}

// Marca os termos encontrados, ignorando acentos e maiúsculas
function destacar(texto, termos) {
  const original = String(texto == null ? '' : texto);
  const validos = (termos || []).filter(t => t && t.length >= 2);
  if (!validos.length) return escapeHtml(original);
  const chars = Array.from(original);
  let normTxt = '';
  const mapa = [];
  chars.forEach((ch, i) => {
    const n = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) mapa.push(i);
    normTxt += n;
  });
  const marcado = new Array(chars.length).fill(false);
  validos.forEach((t) => {
    let pos = normTxt.indexOf(t);
    while (pos !== -1) {
      for (let k = pos; k < pos + t.length; k++) marcado[mapa[k]] = true;
      pos = normTxt.indexOf(t, pos + 1);
    }
  });
  let html = '';
  let i = 0;
  while (i < chars.length) {
    let j = i;
    while (j < chars.length && marcado[j] === marcado[i]) j++;
    const trecho = escapeHtml(chars.slice(i, j).join(''));
    html += marcado[i] ? `<mark style="background:#fde68a;border-radius:3px;padding:0 1px;">${trecho}</mark>` : trecho;
    i = j;
  }
  return html;
}

function htmlEntrada(data, termos) {
  const quando = new Date(data.data);
  const dataTxt = quando.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const horaTxt = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let local = '';
  if (data.localizacao && typeof data.localizacao.lat === 'number') {
    const l = data.localizacao;
    const rotulo = l.nome || `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`;
    const lua = faseDaLua(quando);
    const c = data.clima;
    const climaTxt = c && typeof c.temp === 'number' ? ` · ${escapeHtml(c.icone)} ${c.temp}°C, ${escapeHtml(c.descricao)}` : '';
    local = `
      <div style="font-size:13px;color:#475569;margin-top:2px;">📍 <a href="https://www.google.com/maps?q=${l.lat},${l.lng}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;">${escapeHtml(rotulo)}</a>${climaTxt} · ${lua.icone} ${escapeHtml(lua.nome)}</div>
      <iframe src="${urlMapa(l.lat, l.lng)}" loading="lazy" title="Mapa" style="width:100%;height:140px;border:0;border-radius:10px;margin-top:8px;"></iframe>`;
  }

  const listaFotos = [].concat(Array.isArray(data.fotos) ? data.fotos : [], data.fotoBase64 ? [data.fotoBase64] : [])
    .filter(f => typeof f === 'string' && f.startsWith('data:image/'));
  const larguraFoto = listaFotos.length > 1 ? '48%' : '100%';
  const fotosHtml = listaFotos.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${listaFotos.map(f => `<img src="${f}" style="max-width:${larguraFoto};border-radius:8px;">`).join('')}</div>`
    : '';

  const arquivosHtml = (Array.isArray(data.arquivos) ? data.arquivos : [])
    .filter(a => a && typeof a.link === 'string' && /^https:\/\/(drive|docs)\.google\.com\//.test(a.link))
    .map(a => `<a href="${escapeHtml(a.link)}" target="_blank" rel="noopener" style="display:inline-block;margin:6px 6px 0 0;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;color:#1e3a8a;text-decoration:none;background:#f8fafc;">📎 ${escapeHtml(a.nome)}</a>`)
    .join('');

  return `
    <div style="border-left:4px solid #2563eb; padding-left:12px; margin-bottom:15px;">
      <div style="font-size:12px; color:#64748b; font-weight:bold; text-transform:capitalize;">${escapeHtml(dataTxt)} · ${escapeHtml(horaTxt)}</div>
      ${local}
      <p style="white-space: pre-wrap; margin: 6px 0;">${destacar(data.texto, termos)}</p>
      ${fotosHtml}
      ${arquivosHtml}
    </div>
  `;
}

function atualizarInfoBusca(n) {
  const info = document.getElementById('buscaInfo');
  if (!info) return;
  if (!busca.consulta.trim()) {
    info.textContent = '';
    return;
  }
  let txt = `${n} de ${todasEntradas.length} entradas`;
  if (busca.modo === 'ia' && busca.extras.length) {
    txt += ` · ✨ termos relacionados: ${busca.extras.slice(0, 12).join(', ')}`;
  }
  info.textContent = txt;
}

function renderTimeline() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  if (!todasEntradas.length) {
    timeline.innerHTML = "<p>Nenhuma entrada salva ainda.</p>";
    atualizarInfoBusca(0);
    return;
  }
  const lista = entradasFiltradas();
  atualizarInfoBusca(lista.length);
  if (!lista.length) {
    timeline.innerHTML = "<p>Nenhuma entrada encontrada para essa busca.</p>";
    return;
  }
  timeline.innerHTML = lista.map(item => htmlEntrada(item.e, busca.termosDestaque)).join('');
}

async function buscarComIA() {
  const input = document.getElementById('buscaInput');
  const botao = document.getElementById('buscaIA');
  const info = document.getElementById('buscaInfo');
  if (!input) return;
  const consulta = input.value.trim();
  if (!consulta) {
    definirBuscaLocal('');
    renderTimeline();
    return;
  }
  botao.disabled = true;
  info.textContent = '✨ Pensando em termos relacionados...';

  const palavras = palavrasDaConsulta(consulta);
  const resposta = await chamarGemini(
    `Você ajuda a buscar em um diário pessoal escrito em português do Brasil. Busca do usuário: "${consulta}". ` +
    `Identifique o tema principal e liste de 8 a 20 palavras ou expressões curtas que possam aparecer em relatos sobre esse tema ` +
    `(sinônimos, formas verbais como treinei/treinar, atividades, lugares e coisas ligadas). ` +
    `Ignore palavras genéricas como "relatos" ou "quero ver". ` +
    `Responda SOMENTE com um array JSON de strings em minúsculas, sem explicações e sem crases.`
  );

  let extras = [];
  try {
    const m = String(resposta).match(/\[[\s\S]*\]/);
    if (m) {
      extras = JSON.parse(m[0])
        .filter(x => typeof x === 'string')
        .map(x => norm(x).trim())
        .filter(x => x.length >= 3)
        .slice(0, 25);
    }
  } catch (err) {
    console.error(err);
  }
  botao.disabled = false;

  if (!extras.length) {
    definirBuscaLocal(consulta);
    renderTimeline();
    info.textContent += ' · (a IA não respondeu; usei a busca normal)';
    return;
  }

  const termos = new Set(palavras.map(radical));
  extras.forEach(x => termos.add(x.includes(' ') ? x : radical(x)));
  busca.consulta = consulta;
  busca.modo = 'ia';
  busca.extras = extras;
  busca.grupos = [Array.from(termos)]; // qualquer termo relacionado serve
  busca.termosDestaque = Array.from(termos);
  renderTimeline();
}

function criarBarraBusca() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  const barra = document.createElement('div');
  barra.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:6px;">
      <input id="buscaInput" type="search" placeholder="🔍 Buscar no diário (ex.: treino, viagem, família)" style="flex:1;min-width:0;padding:10px;border:1px solid #e2e8f0;border-radius:8px;outline:none;font-size:14px;">
      <button id="buscaIA" class="btn-tool" type="button" title="Busca inteligente com IA (ou aperte Enter)">✨ Inteligente</button>
    </div>
    <div id="buscaInfo" style="font-size:12px;color:#64748b;margin-bottom:10px;"></div>`;
  timeline.insertAdjacentElement('beforebegin', barra);

  const input = document.getElementById('buscaInput');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      definirBuscaLocal(input.value);
      renderTimeline();
    }, 250);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      clearTimeout(timer);
      buscarComIA();
    }
  });
  document.getElementById('buscaIA').addEventListener('click', buscarComIA);
}

function escutarEntradasEmTempoReal() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;

  const q = query(collection(db, "diario_entradas"), orderBy("data", "desc"));

  return onSnapshot(q, (querySnapshot) => {
    todasEntradas = [];
    querySnapshot.forEach((docSnap) => todasEntradas.push(docSnap.data()));
    renderTimeline();
  }, (error) => {
    console.error(error);
    timeline.innerHTML = "<p>Erro ao carregar o histórico.</p>";
  });
}

criarBarraBusca();

// 6. LOGIN COM GOOGLE
let cancelarEscuta = null;

function criarTelaLogin() {
  const overlay = document.createElement('div');
  overlay.id = 'loginOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#f1f5f9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;z-index:9999;padding:24px;text-align:center;';
  overlay.innerHTML = `
    <h2 style="margin:0;color:#1e293b;">📔 Meu Diário</h2>
    <p style="margin:0;color:#64748b;">Entre com sua conta Google para acessar.</p>
    <button id="btnLogin" style="padding:14px 24px;font-size:16px;font-weight:bold;border:none;border-radius:12px;background:#1e3a8a;color:#fff;cursor:pointer;">Entrar com Google</button>
    <p id="loginMsg" style="margin:0;color:#b91c1c;font-size:14px;max-width:420px;"></p>
  `;
  overlay.style.display = 'none';
  document.body.appendChild(overlay);

  const btnSair = document.createElement('button');
  btnSair.id = 'btnSair';
  btnSair.innerText = 'Sair';
  btnSair.style.cssText = 'position:fixed;top:8px;right:8px;z-index:1000;padding:6px 12px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;cursor:pointer;display:none;';
  document.body.appendChild(btnSair);

  document.getElementById('btnLogin').addEventListener('click', async () => {
    const loginMsg = document.getElementById('loginMsg');
    loginMsg.innerText = '';
    try {
      await entrarComGoogle();
    } catch (err) {
      console.error(err);
      const mensagens = {
        'auth/popup-blocked': 'O navegador bloqueou a janela de login. Permita pop-ups para este site e tente de novo.',
        'auth/popup-closed-by-user': 'Login cancelado.',
        'auth/cancelled-popup-request': 'Login cancelado.',
        'auth/unauthorized-domain': 'Domínio não autorizado: no Firebase, vá em Authentication > Configurações > Domínios autorizados e adicione tertim-code.github.io.',
        'auth/operation-not-allowed': 'O login com Google não está ativado: no Firebase, vá em Authentication > Método de login e ative o Google.'
      };
      loginMsg.innerText = mensagens[err.code] || `Erro no login (${err.code || 'desconhecido'}).`;
    }
  });

  btnSair.addEventListener('click', async () => {
    if (isRecording) await pararGravacao();
    await signOut(auth);
  });

  return { overlay, btnSair };
}

const telaLogin = criarTelaLogin();

onAuthStateChanged(auth, (user) => {
  if (user) {
    telaLogin.overlay.style.display = 'none';
    telaLogin.btnSair.style.display = 'block';
    if (!cancelarEscuta) cancelarEscuta = escutarEntradasEmTempoReal() || null;
  } else {
    telaLogin.overlay.style.display = 'flex';
    telaLogin.btnSair.style.display = 'none';
    if (cancelarEscuta) { cancelarEscuta(); cancelarEscuta = null; }
    driveToken = null;
    todasEntradas = [];
    const timeline = document.getElementById('timeline');
    if (timeline) timeline.innerHTML = "";
  }
});
