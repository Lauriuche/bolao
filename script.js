// script.js - funções para salvar, listar e excluir expirados
const DB_ROOT = 'cadastros'; // nó no Realtime Database
const DATA_LIMITE = '2025-12-10'; // formato YYYY-MM-DD, altere se quiser

function nowISODate() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function maskPhone(tel) {
  // tel: string, ex: "559912345678" ou "55 99 91234-5678"
  const digits = (tel || '').replace(/\D/g,'');
  if (digits.length < 4) return '*****';
  const first2 = digits.slice(0,2);
  const last1 = digits.slice(-1);
  return `${first2}*****${last1}`;
}

// salvar cadastro
function salvarCadastro(nome, whatsapp) {
  if (!nome || !whatsapp) return Promise.reject('Nome e WhatsApp obrigatórios');
  const db = firebase.database().ref(DB_ROOT);
  const novo = db.push();
  const payload = {
    nome: nome.trim(),
    whatsapp: whatsapp.trim(),
    status: 'aguardando', // aguardando ou pago
    criado_em: new Date().toISOString(),
    data_limite: DATA_LIMITE
  };
  return novo.set(payload);
}

// lista pública (tempo real)
function listarCadastrosPublic() {
  const ref = firebase.database().ref(DB_ROOT);
  const container = document.getElementById('lista');
  if (!container) return;
  ref.on('value', snapshot => {
    const data = snapshot.val() || {};
    const keys = Object.keys(data);
    if (keys.length === 0) {
      container.innerHTML = '<p>Nenhum inscrito.</p>';
      return;
    }
    container.innerHTML = '';
    keys.forEach(k => {
      const item = data[k];
      const div = document.createElement('div');
      div.className = 'item';
      const left = document.createElement('div');
      left.innerHTML = `<strong>${item.nome}</strong><div class="meta">${maskPhone(item.whatsapp)}</div>`;
      const right = document.createElement('div');
      const status = (item.status === 'pago') ? `<span class="status-paid">Pago</span>` : `<span class="status-wait">Aguardando pagamento até ${item.data_limite}</span>`;
      right.innerHTML = status;
      div.appendChild(left);
      div.appendChild(right);
      container.appendChild(div);
    });
  });
}

// função para verificar e excluir expirados (chamar manualmente no admin.html)
async function verificarExpirados() {
  const ref = firebase.database().ref(DB_ROOT);
  const snapshot = await ref.once('value');
  const data = snapshot.val() || {};
  const hoje = nowISODate();
  let removidos = 0;
  for (const key of Object.keys(data)) {
    const item = data[key];
    if (item.status !== 'pago') {
      const limite = item.data_limite || DATA_LIMITE;
      if (limite < hoje) {
        // excluir
        await firebase.database().ref(`${DB_ROOT}/${key}`).remove();
        removidos++;
      }
    }
  }
  return `Verificação concluída. Removidos: ${removidos}`;
}

// marca como pago (poderia ser acessada por admin com UI extra)
// Exemplo de uso: marcarComoPago(key)
function marcarComoPago(key) {
  if (!key) return Promise.reject('Chave obrigatória');
  return firebase.database().ref(`${DB_ROOT}/${key}`).update({ status: 'pago' });
}

// Expor algumas funções para uso em consoles
window.salvarCadastro = salvarCadastro;
window.listarCadastrosPublic = listarCadastrosPublic;
window.verificarExpirados = verificarExpirados;
window.marcarComoPago = marcarComoPago;

// Código para o index.html: lidar com o botão de salvar
if (typeof document !== 'undefined') {
  const btn = document.getElementById('btnSalvar');
  if (btn) {
    btn.addEventListener('click', async () => {
      const nome = document.getElementById('nome').value;
      const wh = document.getElementById('wh').value;
      const msg = document.getElementById('msg');
      msg.innerText = 'Gravando...';
      try {
        await salvarCadastro(nome, wh);
        msg.style.color = 'green';
        msg.innerText = 'Cadastro realizado! Aguardando pagamento.';
        document.getElementById('nome').value = '';
        document.getElementById('wh').value = '';
      } catch (e) {
        msg.style.color = 'red';
        msg.innerText = 'Erro: ' + (e.message || e);
      }
    });
  }
}