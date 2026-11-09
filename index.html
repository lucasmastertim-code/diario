<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meu Diário Pessoal & IA</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #ffffff;
      --primary: #1e3a8a;
      --accent: #2563eb;
      --border: #e2e8f0;
      --text: #1e293b;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 15px;
    }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { text-align: center; color: var(--primary); margin-bottom: 20px; }
    .card {
      background: var(--card);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    textarea {
      width: 100%;
      height: 110px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      box-sizing: border-box;
      font-size: 15px;
      resize: vertical;
      outline: none;
    }
    textarea:focus { border-color: var(--accent); }
    .grid-tools {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    .btn-tool {
      background: #f8fafc;
      border: 1px solid var(--border);
      padding: 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .btn-tool:hover { background: #eff6ff; }
    input[type="file"] { display: none; }
    .btn-save {
      width: 100%;
      background: var(--primary);
      color: white;
      border: none;
      padding: 14px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: bold;
      margin-top: 15px;
      cursor: pointer;
    }
    .btn-save:hover { background: var(--accent); }
    .status { font-size: 13px; color: #64748b; margin-top: 10px; text-align: center; }
    .recording { background: #fee2e2 !important; color: #dc2626 !important; border-color: #fca5a5 !important; }

    /* Estilos do Chat com IA */
    .chat-box {
      height: 200px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: #fafafa;
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .msg { padding: 8px 12px; border-radius: 8px; max-width: 85%; font-size: 14px; line-height: 1.4; }
    .msg-user { background: #dbeafe; color: #1e40af; align-self: flex-end; }
    .msg-ai { background: #e2e8f0; color: #0f172a; align-self: flex-start; }
    .chat-input-row { display: flex; gap: 8px; }
    .chat-input-row input {
      flex: 1;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      outline: none;
    }
  </style>

  <script type="module" src="app.js"></script>
</head>
<body>

<div class="container">
  <h1>📖 Meu Diário Pessoal & IA</h1>

  <!-- PAINEL DE CONVERSA COM A IA -->
  <div class="card">
    <h3>🤖 Conversar com a IA</h3>
    <div class="chat-box" id="chatBox">
      <div class="msg msg-ai">Olá! Como posso ajudar na sua reflexão de hoje? Você pode conversar comigo ou pedir sugestões de escrita.</div>
    </div>
    <div class="chat-input-row">
      <input type="text" id="chatInput" placeholder="Converse ou tire dúvidas com a IA...">
      <button class="btn-tool" id="btnSendChat">Enviar</button>
    </div>
    <div style="margin-top: 8px; display: flex; gap: 8px;">
      <button class="btn-tool" id="btnInspire" style="flex:1;">💡 Sugerir Pergunta</button>
      <button class="btn-tool" id="btnSaveChatToDiary" style="flex:1;">📌 Salvar Chat no Diário</button>
    </div>
  </div>

  <!-- REGISTRO DO DIÁRIO -->
  <div class="card">
    <h3>✍️ Nova Entrada</h3>
    <textarea id="entryText" placeholder="Escreva como foi seu dia ou grave um áudio..."></textarea>

    <div class="grid-tools">
      <button class="btn-tool" id="btnRecord">🎙️ Gravar Voz</button>
      <label class="btn-tool" for="photoInput">📷 Foto</label>
      <input type="file" id="photoInput" accept="image/*">
      <button class="btn-tool" id="btnLocation">📍 Local</button>
    </div>

    <div class="status" id="statusMsg">Pronto para novo registro</div>
    <button class="btn-save" id="btnSave">Salvar Entrada</button>
  </div>

  <!-- HISTÓRICO EM TEMPO REAL -->
  <div class="card">
    <h3>📌 Histórico</h3>
    <div id="timeline">Carregando entradas...</div>
  </div>
</div>

</body>
</html>
