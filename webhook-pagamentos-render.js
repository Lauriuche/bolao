/**
 * Backend Render — Bolão Master
 * - POST /mp/pix                 → cria pagamento PIX transparente (Mercado Pago)
 * - POST /webhook/mercadopago    → confirma pagamento MP
 * - POST /webhook/infinitepay    → confirma pagamento InfinitePay
 * - GET  /health
 *
 * Variáveis de ambiente no Render:
 *   FIREBASE_SERVICE_ACCOUNT  = JSON da service account
 *   FIREBASE_DATABASE_URL     = https://cadastros-bolao-rifas-default-rtdb.firebaseio.com
 *   MP_ACCESS_TOKEN           = APP_USR-... (Access Token do Mercado Pago)
 *   BOLAO_PATH                = bolao/2026/participantes (opcional)
 *   PORT                      = automático no Render
 *
 * Deploy:
 *   1. npm init -y && npm i express firebase-admin node-fetch@2
 *   2. node webhook-pagamentos-render.js
 *   3. Na InfinitePay / MP, configure as URLs de webhook deste serviço
 */

const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3000;
const BOLAO_PATH = process.env.BOLAO_PATH || 'bolao/2026/participantes';
const PEDIDOS_PATH = process.env.PEDIDOS_PATH || 'bolao/2026/pedidos';
const CONFIG_PATH = process.env.CONFIG_PATH || 'bolao/2026/configuracoes';
const LOGS_PATH = process.env.LOGS_PATH || 'bolao/2026/logs';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';

if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://cadastros-bolao-rifas-default-rtdb.firebaseio.com'
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://cadastros-bolao-rifas-default-rtdb.firebaseio.com'
    });
  }
}

const db = admin.database();
const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS para o front chamar /mp/pix
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'bolao-pagamentos',
    mp: !!MP_ACCESS_TOKEN,
    time: new Date().toISOString()
  });
});

app.get('/', (_req, res) => res.json({ ok: true, service: 'bolao-pagamentos' }));

async function getValorCota() {
  const snap = await db.ref(CONFIG_PATH).once('value');
  const cfg = snap.val() || {};
  return parseFloat(cfg.valorCota || 1) || 1;
}

/**
 * Confirma pedido PENDING e soma no participante (total ou parcial).
 * Idempotente: se já CONFIRMED, não soma de novo.
 */
async function confirmarPedido({ orderNsu, amount, source, providerExtra = {} }) {
  if (!orderNsu) return { ok: false, reason: 'missing_order' };

  const pedidoRef = db.ref(`${PEDIDOS_PATH}/${orderNsu}`);
  const pedidoSnap = await pedidoRef.once('value');
  if (!pedidoSnap.exists()) return { ok: false, reason: 'order_not_found' };

  const pedido = pedidoSnap.val();
  if (pedido.status === 'CONFIRMED') {
    return { ok: true, already: true, key: pedido.paid_key };
  }

  const key = pedido.paid_key;
  if (!key) return { ok: false, reason: 'missing_paid_key' };

  const amountToAdd = amount != null ? Number(amount) : Number(pedido.amount) || 0;
  const valorCota = await getValorCota();
  const partRef = db.ref(`${BOLAO_PATH}/${key}`);
  const partSnap = await partRef.once('value');
  if (!partSnap.exists()) return { ok: false, reason: 'participant_not_found' };

  const p = partSnap.val();
  const qt = p.cotas || 1;
  const totalDevido = qt * valorCota;
  const currentPaid = Number(p.valor) || 0;
  const newTotal = Math.round((currentPaid + amountToAdd) * 100) / 100;
  const newStatus = newTotal >= totalDevido - 0.009 ? 'PAGO' : (newTotal > 0 ? 'PARCIAL' : 'PENDENTE');

  await partRef.update({
    valor: newTotal,
    status_compra: newStatus,
    last_webhook_at: Date.now()
  });

  await pedidoRef.update({
    status: 'CONFIRMED',
    confirmedAt: Date.now(),
    confirmedVia: source,
    confirmedAmount: amountToAdd,
    ...providerExtra
  });

  await db.ref(LOGS_PATH).push({
    acao: 'webhook_pagamento',
    extra: {
      key,
      orderNsu,
      amount: amountToAdd,
      status: newStatus,
      tipo: pedido.tipo || null,
      source
    },
    em: Date.now(),
    iso: new Date().toISOString()
  });

  return { ok: true, key, status: newStatus, valor: newTotal, tipo: pedido.tipo || 'TOTAL' };
}

/** Cria PIX transparente no Mercado Pago */
app.post('/mp/pix', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado no Render' });
    }

    const {
      order_nsu,
      paid_key,
      amount,
      description,
      payer_name,
      payer_email,
      notification_url,
      external_reference
    } = req.body || {};

    const valor = Number(amount);
    if (!order_nsu || !paid_key || !(valor > 0)) {
      return res.status(400).json({ error: 'order_nsu, paid_key e amount são obrigatórios' });
    }

    // Garante índice do pedido
    await db.ref(`${PEDIDOS_PATH}/${order_nsu}`).update({
      paid_key,
      amount: valor,
      status: 'PENDING',
      provider: 'mercadopago',
      updatedAt: Date.now()
    });

    const body = {
      transaction_amount: Math.round(valor * 100) / 100,
      description: description || `Bolão ${order_nsu}`,
      payment_method_id: 'pix',
      external_reference: external_reference || order_nsu,
      payer: {
        email: payer_email || `bolao_${Date.now()}@mail.com`,
        first_name: (payer_name || 'Participante').split(' ')[0],
        last_name: (payer_name || 'Bolao').split(' ').slice(1).join(' ') || 'Master'
      }
    };
    if (notification_url) body.notification_url = notification_url;

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': order_nsu
      },
      body: JSON.stringify(body)
    });

    const data = await mpRes.json();
    if (!mpRes.ok) {
      console.error('[mp/pix] erro MP', data);
      return res.status(502).json({ error: data.message || 'Falha Mercado Pago', details: data });
    }

    const poi = data.point_of_interaction || {};
    const tx = poi.transaction_data || {};

    await db.ref(`${PEDIDOS_PATH}/${order_nsu}`).update({
      mp_payment_id: data.id,
      mp_status: data.status
    });

    res.json({
      ok: true,
      payment_id: data.id,
      status: data.status,
      qr_code: tx.qr_code || '',
      qr_code_base64: tx.qr_code_base64 || '',
      ticket_url: tx.ticket_url || null
    });
  } catch (err) {
    console.error('[mp/pix]', err);
    res.status(500).json({ error: 'internal', message: String(err.message || err) });
  }
});

/** Webhook Mercado Pago */
app.post('/webhook/mercadopago', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[webhook/mp]', JSON.stringify(body).slice(0, 600));

    // MP envia type/action + data.id
    let paymentId =
      body.data?.id ||
      body.id ||
      req.query['data.id'] ||
      req.query.id ||
      null;

    // Às vezes vem só topic=payment&id=
    if (!paymentId && (body.topic === 'payment' || req.query.topic === 'payment')) {
      paymentId = body.id || req.query.id;
    }

    if (!paymentId) {
      return res.status(200).json({ received: true, ignored: 'no_payment_id' });
    }

    if (!MP_ACCESS_TOKEN) {
      return res.status(200).json({ received: true, warning: 'no_token' });
    }

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const pay = await mpRes.json();
    if (!mpRes.ok) {
      console.warn('[webhook/mp] fetch payment fail', pay);
      return res.status(200).json({ received: true, warning: 'mp_fetch_fail' });
    }

    const status = (pay.status || '').toLowerCase();
    const paidOk = status === 'approved' || status === 'accredited';
    if (!paidOk) {
      return res.status(200).json({ received: true, ignored: status });
    }

    const orderNsu = pay.external_reference || null;
    const amount = Number(pay.transaction_amount) || null;

    // Se não tiver order no external_reference, tenta achar por mp_payment_id
    let nsu = orderNsu;
    if (!nsu) {
      const pedidosSnap = await db.ref(PEDIDOS_PATH).orderByChild('mp_payment_id').equalTo(Number(paymentId)).once('value');
      if (pedidosSnap.exists()) {
        nsu = Object.keys(pedidosSnap.val())[0];
      }
    }

    const result = await confirmarPedido({
      orderNsu: nsu,
      amount,
      source: 'webhook_mercadopago',
      providerExtra: { mp_payment_id: paymentId, mp_status: status }
    });

    res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[webhook/mp] erro', err);
    res.status(500).json({ error: 'internal' });
  }
});

/** Webhook InfinitePay */
app.post('/webhook/infinitepay', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[webhook/infinitepay]', JSON.stringify(body).slice(0, 800));

    const status = (body.status || body.payment_status || body.event || '').toString().toLowerCase();
    const paidOk = ['paid', 'approved', 'captured', 'success', 'completed', 'payment.paid'].some(s =>
      status.includes(s)
    );
    if (!paidOk) {
      return res.status(200).json({ received: true, ignored: 'status_not_paid' });
    }

    const orderNsu = body.order_nsu || body.orderNsu || body.nsu || body.external_id || '';
    const amountCents = parseInt(body.amount || body.paid_amount || body.value || 0, 10);
    const amount = amountCents > 1000 ? amountCents / 100 : (amountCents > 0 ? amountCents / 100 : null);
    // Heurística: se amount já parece reais (ex: 30.5) usar direto
    let amountReais = null;
    if (body.amount != null && String(body.amount).includes('.')) amountReais = Number(body.amount);
    else if (amountCents >= 100) amountReais = amountCents / 100;
    else if (amountCents > 0) amountReais = amountCents;

    const result = await confirmarPedido({
      orderNsu,
      amount: amountReais,
      source: 'webhook_infinitepay',
      providerExtra: { infinite_raw_status: status }
    });

    res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[webhook/infinitepay] erro', err);
    res.status(500).json({ error: 'internal' });
  }
});

app.listen(PORT, () => {
  console.log(`Bolão pagamentos ouvindo :${PORT}`);
  console.log(`MP token: ${MP_ACCESS_TOKEN ? 'OK' : 'AUSENTE'}`);
});
