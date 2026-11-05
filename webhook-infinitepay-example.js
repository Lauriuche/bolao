/**
 * Webhook InfinitePay → Firebase (exemplo para deploy no Render / Railway / VPS)
 *
 * Uso:
 * 1. npm init -y && npm i express firebase-admin
 * 2. Coloque a service account do Firebase em GOOGLE_APPLICATION_CREDENTIALS
 *    ou defina FIREBASE_SERVICE_ACCOUNT (JSON string)
 * 3. Configure na InfinitePay a URL: https://SEU-APP.onrender.com/webhook/infinitepay
 * 4. node webhook-infinitepay-example.js
 *
 * No checkout do Bolão, use redirect_url normalmente.
 * O webhook confirma o pagamento mesmo se o usuário fechar a aba.
 */

const express = require('express');
const admin = require('firebase-admin');

const PORT = process.env.PORT || 3000;
const BOLAO_PATH = process.env.BOLAO_PATH || 'bolao/2026/participantes';

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
app.use(express.json({ limit: '1mb' }));

// Healthcheck
app.get('/', (_req, res) => res.json({ ok: true, service: 'bolao-webhook' }));

/**
 * InfinitePay pode enviar eventos de pagamento confirmado.
 * Ajuste o parse conforme o payload real da sua conta.
 * Esperamos no mínimo: order_nsu ou metadata com paid_key, e amount em centavos.
 *
 * No frontend, o order_nsu começa com "B..." e o redirect leva paid_key.
 * Uma estratégia robusta: guardar paid_key no order_nsu ou em campo custom.
 */
app.post('/webhook/infinitepay', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[webhook] payload:', JSON.stringify(body).slice(0, 800));

    // Adapte estes campos ao payload real da InfinitePay
    const status = (body.status || body.payment_status || body.event || '').toString().toLowerCase();
    const paidOk = ['paid', 'approved', 'captured', 'success', 'completed', 'payment.paid'].some(s => status.includes(s));

    // Tenta extrair a chave do participante
    // Opção A: order_nsu = "B{timestamp}" e paid_key veio em metadata / redirect params guardados
    // Opção B: você grava no Firebase um índice order_nsu → paid_key ao criar o link
    const orderNsu = body.order_nsu || body.orderNsu || body.nsu || '';
    const paidKey =
      body.paid_key ||
      body.metadata?.paid_key ||
      body.customer?.metadata?.paid_key ||
      null;

    const amountCents = parseInt(body.amount || body.paid_amount || body.value || 0, 10);
    const amount = amountCents > 0 ? amountCents / 100 : null;

    if (!paidOk) {
      return res.status(200).json({ received: true, ignored: 'status_not_paid' });
    }

    // Se não tiver paid_key direto, tenta localizar por índice de pedidos
    let key = paidKey;
    if (!key && orderNsu) {
      const mapSnap = await db.ref(`bolao/2026/pedidos/${orderNsu}`).once('value');
      if (mapSnap.exists()) key = mapSnap.val()?.paid_key || mapSnap.val()?.key;
    }

    if (!key) {
      console.warn('[webhook] paid_key não encontrado');
      return res.status(200).json({ received: true, warning: 'missing_paid_key' });
    }

    const partRef = db.ref(`${BOLAO_PATH}/${key}`);
    const snap = await partRef.once('value');
    if (!snap.exists()) {
      return res.status(200).json({ received: true, warning: 'participant_not_found' });
    }

    const p = snap.val();
    const qt = p.cotas || 1;
    // valor da cota idealmente viria das configs; fallback 1
    const configSnap = await db.ref('bolao/2026/configuracoes').once('value');
    const cfg = configSnap.val() || {};
    const valorCota = parseFloat(cfg.valorCota || 1);
    const totalDevido = qt * valorCota;
    const currentPaid = p.valor || 0;
    const add = amount != null ? amount : totalDevido;
    const newTotal = Math.round((currentPaid + add) * 100) / 100;
    const newStatus = newTotal >= totalDevido ? 'PAGO' : (newTotal > 0 ? 'PARCIAL' : 'PENDENTE');

    await partRef.update({
      valor: newTotal,
      status_compra: newStatus,
      last_webhook_at: Date.now()
    });

    await db.ref('bolao/2026/logs').push({
      acao: 'webhook_pagamento',
      extra: { key, amount: add, status: newStatus, orderNsu },
      em: Date.now(),
      iso: new Date().toISOString()
    });

    console.log('[webhook] confirmado', key, newTotal, newStatus);
    res.status(200).json({ ok: true, key, status: newStatus, valor: newTotal });
  } catch (err) {
    console.error('[webhook] erro', err);
    res.status(500).json({ error: 'internal' });
  }
});

app.listen(PORT, () => console.log(`Webhook listening on :${PORT}`));
