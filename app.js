const FREE_DEBTS = 5, FREE_SENDS = 10;
const TEMPLATES = {
  amable: 'Hola {cliente} 👋, te escribe {negocio}. Un recordatorio amable: tienes pendiente {monto} por {concepto}, con vencimiento {vence}.\n\nPuedes pagar por:\n{pago}\n\n¡Gracias!',
  firme: 'Hola {cliente}, de {negocio}. Tu pago de {monto} por {concepto} venció el {vence}. Por favor regularízalo hoy.\n\nDatos de pago:\n{pago}',
  ultimo: '{cliente}, último aviso de {negocio}: {monto} por {concepto} (venció {vence}). Necesitamos tu pago o una fecha concreta hoy.\n\n{pago}'
};
const $ = id => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem('cz_' + k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem('cz_' + k, JSON.stringify(v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let debts = load('debts', []);
let prices = load('prices', []);
let costs = load('costs', []);
let settings = load('settings', { business: '', pm: '', other: '', cc: '58', tpl: 'amable', tpls: {...TEMPLATES}, rate: 0, pro: false });
let sends = load('sends', { month: '', n: 0 });
let editing = null, sending = null;

const today = () => new Date().toISOString().slice(0, 10);
const rate = () => Number(settings.rate) || 0;
const rem = d => Math.max(0, d.amount - (d.paidAmount || 0));
const usd = d => d.cur === 'USD' ? rem(d) : (rate() ? rem(d) / rate() : 0);
const usdPaid = d => { const p = d.paid ? d.amount : (d.paidAmount || 0); return d.cur === 'USD' ? p : (rate() ? p / rate() : 0); };
const fmtUsd = n => '$' + n.toLocaleString('es-VE', { maximumFractionDigits: 2 });
const fmtBs = n => 'Bs ' + n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const status = d => d.paid ? 'paid' : (d.due < today() ? 'overdue' : 'pending');

function money(d) {
  const a = d.paid ? d.amount : rem(d);
  if (d.cur === 'USD') return fmtUsd(a) + (rate() ? ` (${fmtBs(a * rate())})` : '');
  return fmtBs(a) + (rate() ? ` (${fmtUsd(a / rate())})` : '');
}
function normPhone(p) {
  let n = String(p).replace(/\D/g, '').replace(/^0+/, '');
  if (!n.startsWith(settings.cc)) n = settings.cc + n;
  return n;
}
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
function sendsUsed() { const m = today().slice(0, 7); if (sends.month !== m) { sends = { month: m, n: 0 }; save('sends', sends); } return sends.n; }
function addMonth(iso) { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); }
function paywall(msg) { toast(msg + ' Activa Pro en Ajustes.'); }

function render() {
  const act = debts.filter(d => !d.paid);
  const sum = f => debts.filter(f).reduce((a, d) => a + usd(d), 0);
  $('sum-pending').textContent = fmtUsd(sum(d => !d.paid));
  $('sum-overdue').textContent = fmtUsd(sum(d => status(d) === 'overdue'));
  $('sum-paid').textContent = fmtUsd(debts.reduce((a, d) => a + usdPaid(d), 0));
  const due = act.filter(d => d.due <= today() || d.promise === today()).sort((a, b) => a.due.localeCompare(b.due));
  $('due-list').innerHTML = due.length ? due.map(row).join('') : '<li class="empty">Nada por cobrar hoy 🎉</li>';
  const f = $('filter').value, q = $('search').value.trim().toLowerCase();
  const list = debts.filter(d => (f === 'all' || status(d) === f || (f === 'pending' && !d.paid)) && (!q || (d.client + ' ' + d.concept).toLowerCase().includes(q))).sort((a, b) => a.due.localeCompare(b.due));
  $('debt-list').innerHTML = list.length ? list.map(row).join('') : '<li class="empty">Aún no tienes deudas aquí. Agrega la primera.</li>';
  $('plan-info').textContent = settings.pro ? 'Plan Pro: sin límites.' : `Plan gratis: ${act.length}/${FREE_DEBTS} deudas activas · ${sendsUsed()}/${FREE_SENDS} envíos este mes.`;
  $('plan-state').textContent = settings.pro ? 'Pro activo.' : 'Plan gratis (5 deudas activas y 10 envíos/mes).';
  $('btn-pro').textContent = settings.pro ? 'Volver a plan gratis' : 'Activar Pro';
  renderCosts(); renderPrices();
}
function row(d) {
  const st = status(d);
  const lbl = { pending: 'Pendiente', overdue: 'Vencida', paid: 'Pagada' }[st];
  return `<li><div class="top"><b>${esc(d.client)}</b><b>${esc(money(d))}</b></div>
  <div class="meta">${esc(d.concept || 'Sin concepto')} · vence ${esc(d.due)} <span class="badge ${st}">${lbl}</span>${d.repeat ? ' 🔁' : ''}${d.promise ? ' · promesa ' + esc(d.promise) : ''}${d.sent ? ' · enviados ' + d.sent : ''}</div>
  <div class="acts">${d.paid ? '' : `<button data-a="send" data-id="${d.id}">Cobrar</button><button data-a="part" data-id="${d.id}">Abonar</button><button data-a="paid" data-id="${d.id}">Marcar pagada</button><button data-a="edit" data-id="${d.id}">Editar</button>`}<button data-a="del" data-id="${d.id}">Borrar</button></div></li>`;
}

function buildMessage(d) {
  const pago = [settings.pm && 'Pago Móvil: ' + settings.pm, settings.other].filter(Boolean).join('\n');
  const map = { cliente: d.client, monto: money(d), concepto: d.concept || 'tu pedido', vence: d.due, negocio: settings.business, pago };
  return (settings.tpls[settings.tpl] || TEMPLATES.amable).replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m);
}

document.addEventListener('click', e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const d = debts.find(x => x.id === b.dataset.id);
  if (b.dataset.a === 'send') {
    if (!settings.pm && !settings.other) { toast('Primero agrega tus datos de pago en Ajustes'); return showTab('settings'); }
    if (!settings.pro && sendsUsed() >= FREE_SENDS) return paywall('Llegaste a 10 envíos este mes.');
    sending = d;
    $('send-text').value = buildMessage(d);
    updateLink(); $('dlg-send').showModal();
  } else if (b.dataset.a === 'paid') {
    d.paid = true; d.paidAt = today(); d.paidAmount = d.amount;
    if (d.repeat === 'monthly') debts.push({ ...d, id: crypto.randomUUID(), paid: false, paidAt: null, paidAmount: 0, due: addMonth(d.due), promise: '', sent: 0 });
    save('debts', debts); render(); toast('Marcada como pagada');
  } else if (b.dataset.a === 'part') {
    const sym = d.cur === 'USD' ? '$' : 'Bs';
    const v = parseFloat(String(prompt(`¿Cuánto abonó ${d.client}? (${sym}) Pendiente: ${rem(d)}`) || '').replace(',', '.'));
    if (!(v > 0)) return;
    d.paidAmount = (d.paidAmount || 0) + v;
    if (d.paidAmount >= d.amount) { b.dataset.a = 'paid'; d.paidAmount = d.amount; d.paid = true; d.paidAt = today(); if (d.repeat === 'monthly') debts.push({ ...d, id: crypto.randomUUID(), paid: false, paidAt: null, paidAmount: 0, due: addMonth(d.due), promise: '', sent: 0 }); }
    save('debts', debts); render(); toast(d.paid ? 'Deuda saldada' : 'Abono registrado');
  } else if (b.dataset.a === 'del') {
    if (confirm('¿Borrar esta deuda?')) { debts = debts.filter(x => x !== d); save('debts', debts); render(); }
  } else if (b.dataset.a === 'edit') openDebt(d);
});
function updateLink() {
  $('send-link').href = `https://wa.me/${normPhone(sending.phone)}?text=${encodeURIComponent($('send-text').value)}`;
}
$('send-text').addEventListener('input', updateLink);
$('send-link').addEventListener('click', () => {
  sendsUsed(); sends.n++; save('sends', sends);
  sending.sent = (sending.sent || 0) + 1; save('debts', debts);
  $('dlg-send').close(); render();
});
$('send-cancel').onclick = () => $('dlg-send').close();

function openDebt(d) {
  editing = d || null;
  $('debt-title').textContent = d ? 'Editar deuda' : 'Nueva deuda';
  $('d-client').value = d?.client || ''; $('d-phone').value = d?.phone || ''; $('d-concept').value = d?.concept || '';
  $('d-amount').value = d?.amount || ''; $('d-cur').value = d?.cur || 'USD';
  $('d-due').value = d?.due || today(); $('d-repeat').value = d?.repeat || ''; $('d-promise').value = d?.promise || '';
  $('dlg-debt').showModal();
}
$('btn-new-debt').onclick = () => {
  if (!settings.pro && debts.filter(d => !d.paid).length >= FREE_DEBTS) return paywall('Llegaste a 5 deudas activas.');
  openDebt(null);
};
$('d-cancel').onclick = () => $('dlg-debt').close();
$('form-debt').addEventListener('submit', () => {
  const data = {
    client: $('d-client').value.trim(), phone: $('d-phone').value.trim(), concept: $('d-concept').value.trim(),
    amount: parseFloat($('d-amount').value), cur: $('d-cur').value, due: $('d-due').value,
    repeat: $('d-repeat').value, promise: $('d-promise').value
  };
  if (!data.client || !(data.amount > 0) || normPhone(data.phone).length < 10) return toast('Revisa nombre, monto y teléfono');
  if (editing) { Object.assign(editing, data); if ((editing.paidAmount || 0) >= editing.amount) { editing.paid = true; editing.paidAmount = editing.amount; editing.paidAt = today(); } }
  else debts.push({ id: crypto.randomUUID(), paid: false, paidAmount: 0, sent: 0, ...data });
  save('debts', debts); render(); toast('Guardado');
});
$('filter').onchange = render;
$('search').addEventListener('input', render);

function renderCosts() {
  $('cost-list').innerHTML = costs.length ? costs.map((c, i) => `<li><div class="top"><span>${esc(c.name)}</span><span>${fmtUsd(c.val)} <button data-c="${i}" class="rmcost">✕</button></span></div></li>`).join('') : '<li class="empty">Añade tus costos</li>';
  const total = costs.reduce((a, c) => a + c.val, 0);
  const m = parseFloat($('p-margin').value) || 0, fee = parseFloat($('p-fee').value) || 0;
  const el = $('price-result');
  if (m + fee >= 100) { el.textContent = 'Ganancia + comisión debe ser menor a 100%.'; return; }
  if (!total) { el.textContent = 'Añade costos para calcular el precio.'; return; }
  const price = total / (1 - (m + fee) / 100);
  el.innerHTML = `Costo total: ${fmtUsd(total)}<b>Vende a ${fmtUsd(Math.ceil(price * 100) / 100)}${rate() ? ' · ' + fmtBs(price * rate()) : ''}</b>Ganancia neta: ${fmtUsd(price * m / 100)} por unidad`;
  el.dataset.price = price;
}
function renderPrices() {
  $('price-list').innerHTML = prices.length ? prices.map((p, i) => `<li><div class="top"><b>${esc(p.name)}</b><span>${fmtUsd(p.usd)}${rate() ? ' · ' + fmtBs(p.usd * rate()) : ''} <button data-p="${i}" class="rmprice">✕</button></span></div></li>`).join('') : '<li class="empty">Aún no has guardado precios</li>';
}
document.addEventListener('click', e => {
  const c = e.target.closest('.rmcost'); if (c) { costs.splice(+c.dataset.c, 1); save('costs', costs); renderCosts(); }
  const p = e.target.closest('.rmprice'); if (p) { prices.splice(+p.dataset.p, 1); save('prices', prices); renderPrices(); }
});
$('btn-add-cost').onclick = () => {
  const name = $('c-name').value.trim(), val = parseFloat($('c-val').value);
  if (!name || !(val >= 0)) return toast('Escribe el nombre y el costo');
  costs.push({ name, val }); save('costs', costs); $('c-name').value = ''; $('c-val').value = ''; renderCosts();
};
['p-margin', 'p-fee'].forEach(id => $(id).addEventListener('input', renderCosts));
$('btn-share-price').onclick = () => {
  const price = parseFloat($('price-result').dataset.price), name = $('p-name').value.trim();
  if (!price || !name) return toast('Escribe el producto y añade costos');
  const usdP = Math.ceil(price * 100) / 100;
  prices = prices.filter(p => p.name !== name); prices.push({ name, usd: usdP });
  save('prices', prices); renderPrices();
  const lines = prices.map(p => `• ${p.name}: ${fmtUsd(p.usd)}${rate() ? ' (' + fmtBs(p.usd * rate()) + ')' : ''}`).join('\n');
  window.open('https://wa.me/?text=' + encodeURIComponent(`*${settings.business || 'Lista de precios'}*\n${lines}`), '_blank');
};

function fillSettings() {
  $('s-business').value = settings.business; $('s-pm').value = settings.pm; $('s-other').value = settings.other; $('s-cc').value = settings.cc;
  $('s-tpl').innerHTML = Object.keys(TEMPLATES).map(k => `<option ${k === settings.tpl ? 'selected' : ''}>${k}</option>`).join('');
  $('s-tpl-text').value = settings.tpls[settings.tpl]; $('rate').value = settings.rate || '';
}
$('s-tpl').onchange = () => { settings.tpl = $('s-tpl').value; $('s-tpl-text').value = settings.tpls[settings.tpl]; };
$('btn-save-settings').onclick = () => {
  Object.assign(settings, { business: $('s-business').value.trim(), pm: $('s-pm').value.trim(), other: $('s-other').value.trim(), cc: $('s-cc').value.replace(/\D/g, '') || '58', tpl: $('s-tpl').value });
  settings.tpls[settings.tpl] = $('s-tpl-text').value;
  save('settings', settings); render(); toast('Ajustes guardados');
};
function rateInfo() {
  const f = settings.rateDate ? new Date(settings.rateDate + 'T12:00:00').toLocaleDateString('es-VE') : '';
  $('rate-info').textContent = settings.rateManual ? 'Tasa manual' : (settings.rateDate ? `Tasa oficial BCV · ${f}` : 'Sin tasa: escríbela o pulsa ↻');
}
async function fetchRate(force) {
  if (!force && settings.rateManual) return;
  if (!force && settings.rateCheck === today() && settings.rate) return;
  try {
    const r = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', { cache: 'no-store' });
    const j = await r.json();
    const v = Number(j.promedio);
    if (!(v > 0)) throw new Error('tasa inválida');
    Object.assign(settings, { rate: v, rateManual: false, rateCheck: today(), rateDate: String(j.fechaActualizacion).slice(0, 10) });
    save('settings', settings); $('rate').value = v; render(); rateInfo();
    if (force) toast('Tasa BCV actualizada');
  } catch {
    if (force) toast('No se pudo actualizar. Usando la última tasa guardada');
    rateInfo();
  }
}
$('rate').addEventListener('input', () => {
  settings.rate = parseFloat($('rate').value) || 0; settings.rateManual = true; save('settings', settings); render(); rateInfo();
});
$('btn-rate').onclick = () => fetchRate(true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchRate(); });
$('btn-pro').onclick = () => { settings.pro = !settings.pro; save('settings', settings); render(); toast(settings.pro ? 'Pro activado (modo prueba, sin pago)' : 'Plan gratis'); };
$('btn-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ debts, prices, costs, settings }, null, 2)], { type: 'application/json' }));
  a.download = 'cobrazap-respaldo.json'; a.click();
};

function showTab(t) {
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

fillSettings(); render(); rateInfo(); fetchRate();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');
