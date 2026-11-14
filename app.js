import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, doc, updateDoc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoqyE_A9cAJl2uyBioXNBB8JF94BnStj4",
  authDomain: "meu-diario-app-b8bfd.firebaseapp.com",
  projectId: "meu-diario-app-b8bfd",
  storageBucket: "meu-diario-app-b8bfd.firebasestorage.app",
  messagingSenderId: "376407447383",
  appId: "1:376407447383:web:e41345dad532bbebf2d012"
};

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
let btnMicChat = null;   // (sem uso: o chat com a IA foi removido)
let humorAtual = null;   // humor escolhido na nova entrada
let tagsAtuais = [];     // tags da nova entrada
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

const APP_VERSION = "v12-lembrancas";
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
        arquivos,
        humor: humorAtual,
        tags: tagsAtuais.slice(),
        favorito: false
      });

      statusMsg.innerText = "Entrada salva com sucesso!";
      entryText.value = "";
      baseText = "";
      currentLocation = null;
      climaAtual = null;
      contextoSolicitado = false;
      mostrarContexto();
      humorAtual = null;
      tagsAtuais = [];
      renderExtrasEntrada();
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

// 5. HISTÓRICO, FILTROS, LEMBRANÇAS, HUMOR, TAGS, FAVORITOS E BACKUP
let todasEntradas = [];
const busca = { consulta: '', grupos: [] };
const filtros = { de: '', ate: '', tags: new Set(), soFavoritos: false };
let lembrancaAleatoria = null;
let calMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const HUMORES = [
  { v: 5, e: '😄', n: 'Ótimo' },
  { v: 4, e: '🙂', n: 'Bem' },
  { v: 3, e: '😐', n: 'Normal' },
  { v: 2, e: '😔', n: 'Mal' },
  { v: 1, e: '😢', n: 'Péssimo' }
];
const COR_HUMOR = { 5: '#22c55e', 4: '#84cc16', 3: '#eab308', 2: '#f97316', 1: '#ef4444' };

const MODELOS = [
  { nome: '🙏 Gratidão', tag: 'gratidão', texto: 'Três coisas boas de hoje:\n1. \n2. \n3. ' },
  { nome: '🏋️ Treino', tag: 'treino', texto: 'Treino de hoje:\nO que fiz: \nComo me senti: \nPróximo treino: ' },
  { nome: '🌙 Sonho', tag: 'sonho', texto: 'Sonho de hoje:\nO que aconteceu: \nComo me senti ao acordar: ' },
  { nome: '📝 Resumo do dia', tag: 'resumo', texto: 'O que aconteceu hoje: \nO que aprendi: \nComo me senti: \nPara amanhã: ' }
];

const ESTILO_CHIP = 'padding:6px 10px;border:1px solid #cbd5e1;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;margin:0 6px 6px 0;';

function humorInfo(v) {
  return HUMORES.find(h => h.v === v) || null;
}

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

function chaveDia(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function somarDias(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function mesesAtras(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() - n, 1);
  const ultimo = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), ultimo));
  return r;
}

function textoBuscavel(e) {
  const partes = [e.texto];
  if (e.localizacao && e.localizacao.nome) partes.push(e.localizacao.nome);
  if (e.clima && e.clima.descricao) partes.push(e.clima.descricao);
  if (Array.isArray(e.tags)) partes.push(e.tags.join(' '));
  if (Array.isArray(e.arquivos)) e.arquivos.forEach(a => { if (a && a.nome) partes.push(a.nome); });
  return norm(partes.join(' \n '));
}

function definirBusca(consulta) {
  busca.consulta = consulta;
  busca.grupos = palavrasDaConsulta(consulta).map(radical);
}

function entradaPassaFiltros(e) {
  const dk = chaveDia(e.data);
  if (filtros.de && dk < filtros.de) return false;
  if (filtros.ate && dk > filtros.ate) return false;
  if (filtros.soFavoritos && !e.favorito) return false;
  if (filtros.tags.size) {
    const tg = Array.isArray(e.tags) ? e.tags : [];
    for (const t of filtros.tags) if (!tg.includes(t)) return false;
  }
  if (busca.grupos.length) {
    const txt = textoBuscavel(e);
    if (!busca.grupos.every(g => txt.includes(g))) return false;
  }
  return true;
}

function entradasFiltradas() {
  return todasEntradas.filter(entradaPassaFiltros);
}

function temFiltroAtivo() {
  return !!(busca.consulta.trim() || filtros.de || filtros.ate || filtros.tags.size || filtros.soFavoritos);
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

function fotosDaEntrada(e) {
  return [].concat(Array.isArray(e.fotos) ? e.fotos : [], e.fotoBase64 ? [e.fotoBase64] : [])
    .filter(f => typeof f === 'string' && f.startsWith('data:image/'));
}

function htmlEntrada(data, termos) {
  const quando = new Date(data.data);
  const dataTxt = quando.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const horaTxt = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const humor = humorInfo(data.humor);

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

  const listaFotos = fotosDaEntrada(data);
  const larguraFoto = listaFotos.length > 1 ? '48%' : '100%';
  const fotosHtml = listaFotos.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${listaFotos.map(f => `<img src="${f}" style="max-width:${larguraFoto};border-radius:8px;">`).join('')}</div>`
    : '';

  const arquivosHtml = (Array.isArray(data.arquivos) ? data.arquivos : [])
    .filter(a => a && typeof a.link === 'string' && /^https:\/\/(drive|docs)\.google\.com\//.test(a.link))
    .map(a => `<a href="${escapeHtml(a.link)}" target="_blank" rel="noopener" style="display:inline-block;margin:6px 6px 0 0;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;color:#1e3a8a;text-decoration:none;background:#f8fafc;">📎 ${escapeHtml(a.nome)}</a>`)
    .join('');

  const tagsHtml = (Array.isArray(data.tags) ? data.tags : [])
    .map(t => `<button type="button" data-tag="${escapeHtml(t)}" style="${ESTILO_CHIP}background:#eff6ff;color:#1e3a8a;border-color:#bfdbfe;margin:6px 6px 0 0;">#${escapeHtml(t)}</button>`)
    .join('');

  const estrela = data.id
    ? `<button type="button" data-fav="${escapeHtml(data.id)}" title="${data.favorito ? 'Remover dos favoritos' : 'Favoritar'}" style="background:none;border:none;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">${data.favorito ? '⭐' : '☆'}</button>`
    : '';

  return `
    <div style="border-left:4px solid ${data.favorito ? '#f59e0b' : '#2563eb'}; padding-left:12px; margin-bottom:15px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:12px; color:#64748b; font-weight:bold; text-transform:capitalize;">${escapeHtml(dataTxt)} · ${escapeHtml(horaTxt)}${humor ? ` <span title="${humor.n}" style="font-size:16px;">${humor.e}</span>` : ''}</div>
        ${estrela}
      </div>
      ${local}
      <p style="white-space: pre-wrap; margin: 6px 0;">${destacar(data.texto, termos)}</p>
      ${fotosHtml}
      ${arquivosHtml}
      <div>${tagsHtml}</div>
    </div>
  `;
}

function atualizarInfoBusca(n) {
  const info = document.getElementById('buscaInfo');
  if (!info) return;
  info.textContent = temFiltroAtivo() ? `${n} de ${todasEntradas.length} entradas` : '';
}

function contarTags() {
  const c = {};
  todasEntradas.forEach(e => (Array.isArray(e.tags) ? e.tags : []).forEach(t => { c[t] = (c[t] || 0) + 1; }));
  return c;
}

function renderFiltroTags() {
  const box = document.getElementById('filtroTags');
  if (!box) return;
  const c = contarTags();
  const nomes = Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b));
  box.innerHTML = nomes.slice(0, 20).map((t) => {
    const ativo = filtros.tags.has(t);
    const cor = ativo ? 'background:#1e3a8a;color:#fff;border-color:#1e3a8a;' : 'background:#f8fafc;color:#1e3a8a;';
    return `<button type="button" data-ftag="${escapeHtml(t)}" style="${ESTILO_CHIP}${cor}">#${escapeHtml(t)} (${c[t]})</button>`;
  }).join('');
}

function renderTimeline() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  renderFiltroTags();
  if (!todasEntradas.length) {
    timeline.innerHTML = "<p>Nenhuma entrada salva ainda.</p>";
    atualizarInfoBusca(0);
    return;
  }
  const lista = entradasFiltradas();
  atualizarInfoBusca(lista.length);
  if (!lista.length) {
    timeline.innerHTML = "<p>Nenhuma entrada encontrada com esses filtros.</p>";
    return;
  }
  timeline.innerHTML = lista.map(e => htmlEntrada(e, busca.grupos)).join('');
}

// ---------- filtros (palavra, data, tags, favoritos) ----------
function intervaloAtalho(nome) {
  const hoje = new Date();
  if (nome === 'hoje') return [chaveDia(hoje), chaveDia(hoje)];
  if (nome === '7') return [chaveDia(somarDias(hoje, -6)), chaveDia(hoje)];
  if (nome === '30') return [chaveDia(somarDias(hoje, -29)), chaveDia(hoje)];
  if (nome === 'mes') return [chaveDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), chaveDia(hoje)];
  return ['', ''];
}

function atalhoAtivo() {
  for (const n of ['hoje', '7', '30', 'mes', 'tudo']) {
    const par = intervaloAtalho(n);
    if (par[0] === filtros.de && par[1] === filtros.ate) return n;
  }
  return null;
}

function sincronizarCamposFiltro() {
  const de = document.getElementById('filtroDe');
  const ate = document.getElementById('filtroAte');
  if (de) de.value = filtros.de;
  if (ate) ate.value = filtros.ate;
  const ativo = atalhoAtivo();
  document.querySelectorAll('#barraFiltros [data-atalho]').forEach((b) => {
    const on = b.getAttribute('data-atalho') === ativo;
    b.style.background = on ? '#dbeafe' : '#f8fafc';
    b.style.borderColor = on ? '#2563eb' : '#cbd5e1';
  });
  const fav = document.getElementById('btnFavoritos');
  if (fav) {
    fav.style.background = filtros.soFavoritos ? '#fef3c7' : '#f8fafc';
    fav.style.borderColor = filtros.soFavoritos ? '#f59e0b' : '#cbd5e1';
  }
  renderCalendario();
}

function limparFiltros(renderizar) {
  busca.consulta = '';
  busca.grupos = [];
  filtros.de = '';
  filtros.ate = '';
  filtros.tags.clear();
  filtros.soFavoritos = false;
  const input = document.getElementById('buscaInput');
  if (input) input.value = '';
  sincronizarCamposFiltro();
  if (renderizar !== false) renderTimeline();
}

function alternarTagFiltro(t) {
  if (filtros.tags.has(t)) filtros.tags.delete(t);
  else filtros.tags.add(t);
  renderTimeline();
}

function irParaDia(chave) {
  limparFiltros(false);
  filtros.de = chave;
  filtros.ate = chave;
  sincronizarCamposFiltro();
  renderTimeline();
  const alvo = document.getElementById('barraFiltros');
  if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function criarFiltros() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  const barra = document.createElement('div');
  barra.id = 'barraFiltros';
  const estiloData = 'padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;';
  const atalho = (id, rotulo) => `<button type="button" data-atalho="${id}" style="${ESTILO_CHIP}background:#f8fafc;color:#1e3a8a;">${rotulo}</button>`;
  barra.innerHTML = `
    <input id="buscaInput" type="search" placeholder="🔍 Buscar no diário (ex.: treino, viagem, família)" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #e2e8f0;border-radius:8px;outline:none;font-size:14px;margin-bottom:8px;">
    <div>${atalho('hoje', 'Hoje')}${atalho('7', '7 dias')}${atalho('30', '30 dias')}${atalho('mes', 'Este mês')}${atalho('tudo', 'Tudo')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
      <label style="font-size:12px;color:#64748b;">De <input type="date" id="filtroDe" style="${estiloData}"></label>
      <label style="font-size:12px;color:#64748b;">Até <input type="date" id="filtroAte" style="${estiloData}"></label>
      <button type="button" id="btnFavoritos" style="${ESTILO_CHIP}background:#f8fafc;color:#92400e;margin:0;">⭐ Favoritos</button>
      <button type="button" id="btnLimpar" style="${ESTILO_CHIP}background:#f8fafc;color:#475569;margin:0;">Limpar filtros</button>
    </div>
    <div id="filtroTags"></div>
    <div id="buscaInfo" style="font-size:12px;color:#64748b;margin:4px 0 10px;"></div>`;
  timeline.insertAdjacentElement('beforebegin', barra);

  const input = document.getElementById('buscaInput');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      definirBusca(input.value);
      renderTimeline();
    }, 250);
  });
  barra.querySelectorAll('[data-atalho]').forEach((b) => {
    b.addEventListener('click', () => {
      const par = intervaloAtalho(b.getAttribute('data-atalho'));
      filtros.de = par[0];
      filtros.ate = par[1];
      sincronizarCamposFiltro();
      renderTimeline();
    });
  });
  const aoMudarData = () => {
    filtros.de = document.getElementById('filtroDe').value;
    filtros.ate = document.getElementById('filtroAte').value;
    if (filtros.de && filtros.ate && filtros.de > filtros.ate) {
      const troca = filtros.de;
      filtros.de = filtros.ate;
      filtros.ate = troca;
    }
    sincronizarCamposFiltro();
    renderTimeline();
  };
  document.getElementById('filtroDe').addEventListener('change', aoMudarData);
  document.getElementById('filtroAte').addEventListener('change', aoMudarData);
  document.getElementById('btnFavoritos').addEventListener('click', () => {
    filtros.soFavoritos = !filtros.soFavoritos;
    sincronizarCamposFiltro();
    renderTimeline();
  });
  document.getElementById('btnLimpar').addEventListener('click', () => limparFiltros(true));
  document.getElementById('filtroTags').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ftag]');
    if (b) alternarTagFiltro(b.getAttribute('data-ftag'));
  });
  sincronizarCamposFiltro();
}

function ligarEventosTimeline() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;
  timeline.addEventListener('click', async (ev) => {
    const fav = ev.target.closest('[data-fav]');
    if (fav) {
      const id = fav.getAttribute('data-fav');
      const atual = todasEntradas.find(x => x.id === id);
      try {
        await updateDoc(doc(db, "diario_entradas", id), { favorito: !(atual && atual.favorito) });
      } catch (err) {
        console.error(err);
        statusMsg.innerText = "Não consegui atualizar o favorito.";
      }
      return;
    }
    const tag = ev.target.closest('[data-tag]');
    if (tag) alternarTagFiltro(tag.getAttribute('data-tag'));
  });
}

// ---------- extras da nova entrada: modelos, humor e tags ----------
function renderExtrasEntrada() {
  const humorBox = document.getElementById('humorBox');
  if (humorBox) {
    humorBox.querySelectorAll('[data-humor]').forEach((b) => {
      const on = Number(b.getAttribute('data-humor')) === humorAtual;
      b.style.background = on ? '#dbeafe' : '#f8fafc';
      b.style.borderColor = on ? '#2563eb' : '#e2e8f0';
    });
  }
  const tagsBox = document.getElementById('tagsChips');
  if (tagsBox) {
    tagsBox.innerHTML = tagsAtuais.map((t, i) =>
      `<span style="${ESTILO_CHIP}background:#eff6ff;color:#1e3a8a;border-color:#bfdbfe;margin:0;cursor:default;">#${escapeHtml(t)} <button type="button" data-rmtag="${i}" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:0 0 0 4px;font-size:12px;">✕</button></span>`
    ).join('');
  }
}

function adicionarTag(bruto) {
  const t = String(bruto || '').toLowerCase().replace(/^#+/, '').trim().replace(/\s+/g, '-').slice(0, 24);
  if (!t || tagsAtuais.includes(t) || tagsAtuais.length >= 8) return;
  tagsAtuais.push(t);
  renderExtrasEntrada();
}

function usarModelo(m) {
  const atual = entryText.value.replace(/\s+$/, '');
  entryText.value = atual ? atual + '\n\n' + m.texto : m.texto;
  if (isRecording && (alvoDitado || entryText) === entryText) baseText = entryText.value;
  if (m.tag) adicionarTag(m.tag);
  entryText.focus();
  entryText.setSelectionRange(entryText.value.length, entryText.value.length);
}

function atualizarListaTags() {
  const lista = document.getElementById('listaTags');
  if (!lista) return;
  lista.innerHTML = Object.keys(contarTags()).map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
}

function criarExtrasEntrada() {
  if (!entryText) return;
  const modelos = document.createElement('div');
  modelos.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;align-items:center;';
  modelos.innerHTML = '<span style="font-size:12px;color:#64748b;">Modelos:</span>' +
    MODELOS.map((m, i) => `<button type="button" data-modelo="${i}" style="${ESTILO_CHIP}background:#f8fafc;color:#1e3a8a;margin:0;">${m.nome}</button>`).join('');
  entryText.insertAdjacentElement('beforebegin', modelos);
  modelos.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-modelo]');
    if (b) usarModelo(MODELOS[Number(b.getAttribute('data-modelo'))]);
  });

  const extras = document.createElement('div');
  extras.style.cssText = 'margin-top:10px;';
  extras.innerHTML = `
    <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Como você está?</div>
    <div id="humorBox" style="display:flex;gap:6px;margin-bottom:10px;">${HUMORES.map(h => `<button type="button" data-humor="${h.v}" title="${h.n}" style="flex:1;padding:8px 0;font-size:22px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;cursor:pointer;">${h.e}</button>`).join('')}</div>
    <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Tags</div>
    <div id="tagsChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>
    <input id="tagInput" list="listaTags" placeholder="Digite uma tag e aperte Enter (ex.: treino, família)" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;">
    <datalist id="listaTags"></datalist>`;
  entryText.insertAdjacentElement('afterend', extras);

  extras.querySelector('#humorBox').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-humor]');
    if (!b) return;
    const v = Number(b.getAttribute('data-humor'));
    humorAtual = humorAtual === v ? null : v;
    renderExtrasEntrada();
  });
  extras.querySelector('#tagsChips').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rmtag]');
    if (!b) return;
    tagsAtuais.splice(Number(b.getAttribute('data-rmtag')), 1);
    renderExtrasEntrada();
  });
  const tagInput = extras.querySelector('#tagInput');
  tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      adicionarTag(tagInput.value);
      tagInput.value = '';
    }
  });
  tagInput.addEventListener('change', () => {
    adicionarTag(tagInput.value);
    tagInput.value = '';
  });
}

// ---------- lembranças ----------
function calcularLembrancas(hoje) {
  const base = hoje || new Date();
  const lista = [];
  const hojeK = chaveDia(base);
  const ano = base.getFullYear();
  todasEntradas.forEach((e) => {
    const d = new Date(e.data);
    if (d.getMonth() === base.getMonth() && d.getDate() === base.getDate() && d.getFullYear() < ano) {
      const n = ano - d.getFullYear();
      lista.push({ rotulo: `Neste dia, há ${n} ${n === 1 ? 'ano' : 'anos'}`, e });
    }
  });
  const marcos = [
    ['Há 1 semana', somarDias(base, -7)],
    ['Há 1 mês', mesesAtras(base, 1)],
    ['Há 6 meses', mesesAtras(base, 6)]
  ];
  marcos.forEach((m) => {
    const de = chaveDia(somarDias(m[1], -1));
    const ate = chaveDia(somarDias(m[1], 1));
    todasEntradas.forEach((e) => {
      const k = chaveDia(e.data);
      if (k >= de && k <= ate && k !== hojeK) lista.push({ rotulo: m[0], e });
    });
  });
  return lista;
}

function resumoTexto(t, max) {
  const s = String(t || '').trim();
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}

function htmlLembranca(item) {
  const e = item.e;
  const d = new Date(e.data);
  const dataTxt = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const humor = humorInfo(e.humor);
  const lugar = e.localizacao && e.localizacao.nome ? ` · 📍 ${escapeHtml(e.localizacao.nome)}` : '';
  const foto = fotosDaEntrada(e)[0];
  const thumb = foto ? `<img src="${foto}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-top:6px;">` : '';
  return `
    <div data-dia="${chaveDia(e.data)}" style="cursor:pointer;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:8px;background:#f8fafc;">
      <div style="font-size:12px;color:#2563eb;font-weight:bold;">${escapeHtml(item.rotulo)}</div>
      <div style="font-size:12px;color:#64748b;">${escapeHtml(dataTxt)}${humor ? ' · ' + humor.e : ''}${lugar}</div>
      <div style="margin-top:4px;font-size:14px;white-space:pre-wrap;">${escapeHtml(resumoTexto(e.texto, 200))}</div>
      ${thumb}
    </div>`;
}

function renderLembrancas() {
  const el = document.getElementById('lembrancasLista');
  if (!el) return;
  const itens = [];
  if (lembrancaAleatoria) itens.push(lembrancaAleatoria);
  calcularLembrancas().forEach(i => itens.push(i));
  if (!itens.length) {
    el.innerHTML = '<p style="font-size:14px;color:#64748b;margin:0 0 8px;">Ainda não há lembranças para hoje. Elas aparecem quando você tem entradas de 1 semana, 1 mês, 6 meses ou de anos atrás. Enquanto isso, use o sorteio ou o calendário.</p>';
    return;
  }
  el.innerHTML = itens.map(htmlLembranca).join('');
}

function sortearLembranca() {
  const hojeK = chaveDia(new Date());
  const candidatas = todasEntradas.filter(e => chaveDia(e.data) !== hojeK);
  if (!candidatas.length) {
    lembrancaAleatoria = null;
    statusMsg.innerText = "Ainda não há entradas antigas para sortear.";
    renderLembrancas();
    return;
  }
  lembrancaAleatoria = { rotulo: '🎲 Lembrança aleatória', e: candidatas[Math.floor(Math.random() * candidatas.length)] };
  renderLembrancas();
}

function renderCalendario() {
  const el = document.getElementById('calendario');
  if (!el) return;
  const ano = calMes.getFullYear();
  const mes = calMes.getMonth();
  const nomeMes = calMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const primeiro = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const contagem = {};
  todasEntradas.forEach((e) => {
    const k = chaveDia(e.data);
    contagem[k] = (contagem[k] || 0) + 1;
  });
  const hojeK = chaveDia(new Date());
  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <button type="button" class="btn-tool" data-cal="-1" style="padding:6px 14px;">‹</button>
      <strong style="text-transform:capitalize;">${escapeHtml(nomeMes)}</strong>
      <button type="button" class="btn-tool" data-cal="1" style="padding:6px 14px;">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;font-size:13px;">`;
  ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach((d) => { html += `<div style="color:#94a3b8;font-size:11px;">${d}</div>`; });
  for (let i = 0; i < primeiro; i++) html += '<div></div>';
  for (let d = 1; d <= diasNoMes; d++) {
    const k = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const tem = contagem[k];
    const sel = filtros.de && filtros.de === filtros.ate && filtros.de === k;
    let estilo = 'padding:6px 0;border-radius:8px;cursor:pointer;font-size:13px;border:1px solid ' + (k === hojeK ? '#2563eb' : 'transparent') + ';';
    if (sel) estilo += 'background:#1e3a8a;color:#fff;';
    else if (tem) estilo += 'background:#dbeafe;color:#1e3a8a;font-weight:bold;';
    else estilo += 'background:transparent;color:#334155;';
    html += `<button type="button" data-dia="${k}" title="${tem ? tem + ' entrada(s)' : 'Sem entradas'}" style="${estilo}">${d}${tem ? '<span style="display:block;font-size:8px;line-height:6px;">●</span>' : ''}</button>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

// ---------- resumo (humor e tags) e backup ----------
function renderResumo() {
  const el = document.getElementById('resumoConteudo');
  if (!el) return;
  const hoje = new Date();
  const dias = [];
  for (let i = 29; i >= 0; i--) dias.push(chaveDia(somarDias(hoje, -i)));
  const soma = {};
  const cont = {};
  todasEntradas.forEach((e) => {
    if (typeof e.humor === 'number') {
      const k = chaveDia(e.data);
      soma[k] = (soma[k] || 0) + e.humor;
      cont[k] = (cont[k] || 0) + 1;
    }
  });
  let total = 0;
  let n = 0;
  const barras = dias.map((k) => {
    if (!cont[k]) return `<div title="${k}: sem humor registrado" style="flex:1;height:4px;background:#e2e8f0;border-radius:2px;"></div>`;
    const media = soma[k] / cont[k];
    total += soma[k];
    n += cont[k];
    return `<div title="${k}: média ${media.toFixed(1)}" style="flex:1;height:${Math.round(media / 5 * 70)}px;background:${COR_HUMOR[Math.round(media)]};border-radius:3px 3px 0 0;"></div>`;
  }).join('');

  let legenda;
  if (n) {
    const mediaGeral = total / n;
    const h = humorInfo(Math.round(mediaGeral));
    legenda = `Últimos 30 dias: média ${mediaGeral.toFixed(1)} de 5 ${h ? h.e : ''} (${n} ${n === 1 ? 'registro' : 'registros'} de humor)`;
  } else {
    legenda = 'Marque o humor nas suas entradas para ver o gráfico dos últimos 30 dias.';
  }

  const c = contarTags();
  const topTags = Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b)).slice(0, 8)
    .map(t => `#${escapeHtml(t)} (${c[t]})`).join(' · ');

  el.innerHTML = `
    <div style="font-size:13px;color:#475569;margin-bottom:6px;">${escapeHtml(legenda)}</div>
    <div style="display:flex;align-items:flex-end;gap:2px;height:72px;margin-bottom:10px;">${barras}</div>
    <div style="font-size:13px;color:#475569;">${topTags ? 'Tags mais usadas: ' + topTags : 'Ainda não há tags usadas.'}</div>`;
}

function baixarArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function textoDaEntrada(e) {
  const d = new Date(e.data);
  const linhas = [`=== ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ===`];
  if (e.localizacao) linhas.push(`Local: ${e.localizacao.nome || `${e.localizacao.lat}, ${e.localizacao.lng}`}`);
  if (e.clima && typeof e.clima.temp === 'number') linhas.push(`Clima: ${e.clima.temp}°C, ${e.clima.descricao}`);
  const h = humorInfo(e.humor);
  if (h) linhas.push(`Humor: ${h.e} ${h.n}`);
  if (Array.isArray(e.tags) && e.tags.length) linhas.push(`Tags: ${e.tags.map(t => '#' + t).join(' ')}`);
  if (e.favorito) linhas.push('Favorito: sim');
  linhas.push('', e.texto || '');
  if (Array.isArray(e.arquivos) && e.arquivos.length) {
    linhas.push('', 'Arquivos:');
    e.arquivos.forEach(a => linhas.push(`- ${a.nome}: ${a.link}`));
  }
  const nf = fotosDaEntrada(e).length;
  if (nf) linhas.push('', `(${nf} foto(s): estão no backup .json)`);
  return linhas.join('\n');
}

function exportarBackupJson() {
  if (!todasEntradas.length) { statusMsg.innerText = "Não há entradas para exportar."; return; }
  const dados = { app: 'Meu Diário', versao: APP_VERSION, exportadoEm: new Date().toISOString(), total: todasEntradas.length, entradas: todasEntradas };
  baixarArquivo(`diario-backup-${chaveDia(new Date())}.json`, JSON.stringify(dados), 'application/json');
  statusMsg.innerText = `Backup baixado (${todasEntradas.length} entradas).`;
}

function exportarTexto() {
  if (!todasEntradas.length) { statusMsg.innerText = "Não há entradas para exportar."; return; }
  const antigas = todasEntradas.slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
  baixarArquivo(`diario-${chaveDia(new Date())}.txt`, antigas.map(textoDaEntrada).join('\n\n\n'), 'text/plain;charset=utf-8');
  statusMsg.innerText = `Texto exportado (${todasEntradas.length} entradas).`;
}

// ---------- cartões novos na página ----------
function criarCards() {
  const container = document.querySelector('.container') || document.body;

  // O chat com a IA foi removido
  const chat = document.getElementById('chatBox');
  if (chat) {
    const cartao = chat.closest('.card');
    if (cartao) cartao.remove();
  }

  const lembr = document.createElement('div');
  lembr.className = 'card';
  lembr.innerHTML = `
    <h3 style="margin-top:0;">✨ Lembranças</h3>
    <div id="lembrancasLista"></div>
    <button type="button" id="btnAleatoria" class="btn-tool" style="margin-top:4px;">🎲 Lembrança aleatória</button>
    <details style="margin-top:12px;">
      <summary style="cursor:pointer;font-weight:600;color:var(--primary);">📅 Calendário</summary>
      <div id="calendario" style="margin-top:10px;"></div>
    </details>`;
  const primeiro = container.querySelector('.card');
  if (primeiro && primeiro.parentNode === container) container.insertBefore(lembr, primeiro);
  else container.appendChild(lembr);

  lembr.querySelector('#btnAleatoria').addEventListener('click', sortearLembranca);
  lembr.querySelector('#lembrancasLista').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-dia]');
    if (b) irParaDia(b.getAttribute('data-dia'));
  });
  lembr.querySelector('#calendario').addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-cal]');
    if (nav) {
      calMes = new Date(calMes.getFullYear(), calMes.getMonth() + Number(nav.getAttribute('data-cal')), 1);
      renderCalendario();
      return;
    }
    const dia = ev.target.closest('[data-dia]');
    if (dia) irParaDia(dia.getAttribute('data-dia'));
  });

  const resumo = document.createElement('div');
  resumo.className = 'card';
  resumo.innerHTML = `
    <h3 style="margin-top:0;">📊 Resumo e backup</h3>
    <div id="resumoConteudo"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
      <button type="button" id="btnBackupJson" class="btn-tool">⬇️ Backup completo (.json)</button>
      <button type="button" id="btnExportTxt" class="btn-tool">📄 Exportar texto (.txt)</button>
    </div>
    <div style="font-size:12px;color:#64748b;margin-top:8px;">O backup inclui todas as entradas e as fotos (versão reduzida). Arquivos do Drive entram como links.</div>`;
  container.appendChild(resumo);
  resumo.querySelector('#btnBackupJson').addEventListener('click', exportarBackupJson);
  resumo.querySelector('#btnExportTxt').addEventListener('click', exportarTexto);
}

function renderTudo() {
  renderTimeline();
  renderLembrancas();
  renderCalendario();
  renderResumo();
  atualizarListaTags();
}

function escutarEntradasEmTempoReal() {
  const timeline = document.getElementById('timeline');
  if (!timeline) return;

  const q = query(collection(db, "diario_entradas"), orderBy("data", "desc"));

  return onSnapshot(q, (querySnapshot) => {
    todasEntradas = [];
    querySnapshot.forEach((docSnap) => todasEntradas.push({ ...docSnap.data(), id: docSnap.id }));
    renderTudo();
  }, (error) => {
    console.error(error);
    timeline.innerHTML = "<p>Erro ao carregar o histórico.</p>";
  });
}

// --- inicialização ---
criarCards();
criarExtrasEntrada();
criarFiltros();
ligarEventosTimeline();
renderExtrasEntrada();
renderTudo();

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
    renderTudo();
  }
});
