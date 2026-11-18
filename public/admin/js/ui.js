import { esc, toPt, ptToInput, toast, $, $$, egp, todayCairo, api } from '/js/common.js';

export function sheet(title, html, { onMount } = {}) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><div class="sheet-body">${html}</div></div>`;
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  const close = () => { back.remove(); if (!$('.sheet-backdrop')) document.body.style.overflow = ''; };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  const first = $('input:not([type=hidden]), select, textarea', back);
  if (first && !('ontouchstart' in window)) first.focus();
  if (onMount) onMount(back.querySelector('.sheet-body'), close);
  return { el: back.querySelector('.sheet-body'), close };
}

export const confirmBox = (title, message, okLabel = 'تأكيد', danger = true) =>
  new Promise((resolve) => {
    const s = sheet(title, `<p>${esc(message)}</p><div class="actions"><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(okLabel)}</button><button class="btn ghost" data-no>إلغاء</button></div>`);
    $('[data-ok]', s.el).onclick = () => { s.close(); resolve(true); };
    $('[data-no]', s.el).onclick = () => { s.close(); resolve(false); };
  });

function fieldHtml(f, v) {
  const id = 'f_' + f.name;
  const val = v === undefined || v === null ? '' : v;
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}" maxlength="${f.max || 1000}">${esc(val)}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.name}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'checkbox') return `<div class="field"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
  else {
    const t = f.type === 'date' ? 'date' : f.type === 'password' ? 'password' : f.type === 'email' ? 'email' : 'text';
    const mode = f.type === 'money' ? 'decimal' : f.type === 'int' ? 'numeric' : '';
    input = `<input id="${id}" name="${f.name}" type="${t}" ${mode ? `inputmode="${mode}"` : ''} value="${esc(f.type === 'money' && val !== '' ? ptToInput(val) : val)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.type === 'email' ? 'dir="ltr"' : ''} autocomplete="off">`;
  }
  return `<div class="field"><label for="${id}">${esc(f.label)}${f.type === 'money' ? ' (ج.م)' : ''}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}<div class="err" data-err="${f.name}"></div></div>`;
}

// Opens a form in a sheet. Money fields are typed in EGP and sent as integer piasters.
export function formSheet({ title, fields, values = {}, submit = 'حفظ', extra = '', onMount, onSubmit }) {
  const html = `<form novalidate>${fields.map((f) => fieldHtml(f, values[f.name])).join('')}${extra}<div class="err" data-err="_form" role="alert"></div>
    <div class="actions"><button class="btn gold" type="submit">${esc(submit)}</button><button class="btn ghost" type="button" data-cancel>إلغاء</button></div></form>`;
  return sheet(title, html, {
    onMount: (el, close) => {
      const form = $('form', el);
      $('[data-cancel]', el).onclick = close;
      if (onMount) onMount(el, close);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        $$('[data-err]', el).forEach((x) => (x.textContent = ''));
        const out = {}; const errs = {};
        for (const f of fields) {
          const node = form.elements[f.name];
          let raw = f.type === 'checkbox' ? node.checked : node.value.trim();
          if (f.type === 'money') { if (raw === '') { if (f.required !== false) errs[f.name] = 'مطلوب'; out[f.name] = f.optional ? null : 0; } else { const pt = toPt(raw); if (pt === null) errs[f.name] = 'اكتب مبلغًا صحيحًا (مثال 45 أو 45.50)'; else out[f.name] = pt; } }
          else if (f.type === 'int') { if (raw === '') { if (f.required) errs[f.name] = 'مطلوب'; out[f.name] = f.optional ? null : 0; } else if (!/^-?\d+$/.test(raw.replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)))) errs[f.name] = 'اكتب رقمًا صحيحًا'; else out[f.name] = parseInt(raw.replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)), 10); }
          else if (f.type === 'select' && f.numeric) out[f.name] = raw === '' ? null : parseInt(raw, 10);
          else out[f.name] = raw;
          if (f.required && (raw === '' || raw === false) && f.type !== 'checkbox' && !errs[f.name]) errs[f.name] = 'مطلوب';
        }
        if (Object.keys(errs).length) { showFieldErrors(el, errs); return; }
        const btn = $('button[type=submit]', el); btn.disabled = true;
        try { await onSubmit(out, close, el); } catch (err) { showFieldErrors(el, { ...err.fields, ...(err.fields && Object.keys(err.fields).length ? {} : { _form: err.message }) }); if (!err.fields || !Object.keys(err.fields).length) toast(err.message, 'err'); }
        finally { btn.disabled = false; }
      });
    },
  });
}
export function showFieldErrors(el, errs) {
  for (const [k, m] of Object.entries(errs || {})) { const e = $(`[data-err="${k}"]`, el); if (e) e.textContent = m; }
  const first = $('[data-err]:not(:empty)', el); if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function tabsBar(items, active) {
  return `<div class="seg" role="group">${items.map(([k, l]) => `<button type="button" data-seg="${k}" aria-pressed="${k === active}">${esc(l)}</button>`).join('')}</div>`;
}

export function delta(cur, prev) {
  if (!prev) return cur ? '<span class="d flat">جديد</span>' : '<span class="d flat">—</span>';
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return '<span class="d flat">بدون تغيير</span>';
  return `<span class="d ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% عن الفترة السابقة</span>`;
}

// Grouped bars (revenue, expenses) + net-profit line, drawn as inline SVG.
export function barChart(rows, label = (r) => r.period) {
  if (!rows.length) return '<div class="empty">لا توجد بيانات في هذه الفترة بعد.</div>';
  const W = 640, H = 220, pl = 8, pb = 26, pt = 10;
  const vals = rows.flatMap((r) => [r.revenue_pt, r.expenses_pt, r.net_profit_pt]);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const y = (v) => pt + ((max - v) / (max - min)) * (H - pt - pb);
  const slot = (W - pl * 2) / rows.length, bw = Math.min(22, slot / 3);
  const bars = rows.map((r, i) => {
    const x = pl + slot * i + slot / 2;
    return `<rect x="${x - bw - 1}" y="${Math.min(y(r.revenue_pt), y(0))}" width="${bw}" height="${Math.abs(y(r.revenue_pt) - y(0))}" fill="#71721e" rx="2"><title>${esc(label(r))}: الإيراد ${egp(r.revenue_pt)}</title></rect>
      <rect x="${x + 1}" y="${Math.min(y(r.expenses_pt), y(0))}" width="${bw}" height="${Math.abs(y(r.expenses_pt) - y(0))}" fill="#cc7f1b" rx="2"><title>${esc(label(r))}: المصروفات ${egp(r.expenses_pt)}</title></rect>
      ${rows.length <= 16 || i % Math.ceil(rows.length / 12) === 0 ? `<text x="${x}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#7b6248">${esc(String(label(r)).slice(-5))}</text>` : ''}`;
  }).join('');
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${pl + slot * i + slot / 2},${y(r.net_profit_pt)}`).join(' ');
  const dots = rows.map((r, i) => `<circle cx="${pl + slot * i + slot / 2}" cy="${y(r.net_profit_pt)}" r="3" fill="#4e2606"><title>${esc(label(r))}: صافي الربح ${egp(r.net_profit_pt)}</title></circle>`).join('');
  return `<div class="chart"><div class="legend"><span><i style="background:#71721e"></i>الإيراد</span><span><i style="background:#cc7f1b"></i>المصروفات</span><span><i style="background:#4e2606"></i>صافي الربح</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="رسم بياني للإيراد والمصروفات وصافي الربح"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#d8c19a"/>${bars}<path d="${line}" fill="none" stroke="#4e2606" stroke-width="2"/>${dots}</svg></div>`;
}

export async function downloadCsv(path, filename) {
  const res = await api(path);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const monthStart = () => todayCairo().slice(0, 8) + '01';
export const money = (pt, cls = true) => `<span class="num ${cls && pt < 0 ? 'neg' : ''}">${egp(pt)}</span>`;
