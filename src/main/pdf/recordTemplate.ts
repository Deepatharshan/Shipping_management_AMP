/**
 * The monthly shipping record as A4 landscape pages, in the layout of the old printout
 * ("Shipping Record for the Month of September 2026").
 *
 * Every page repeats Page : n, the title, the report date and the column titles. Each invoice is one
 * block (never split). A page ends with SUB TOTAL for its own rows; the last page also has GRAND TOTAL.
 * The page script does the breaks and the sub totals after layout (see render.ts).
 */
import { dmy, moneyGrouped, num } from '@shared/invoice'
import { FACTORIES, monthTitle, recordTotals, rupees, type ShippingRecord } from '@shared/shippingRecord'

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const amt = (v: string) => (v.trim() ? moneyGrouped(num(v)) : '')
const plain = (v: string) => (v.trim() ? num(v).toFixed(2) : '')

export function recordHtml(rec: ShippingRecord): string {
  const g = recordTotals(rec.rows)

  const header = `
    <div class="top">
      <div class="pg">Page : <span class="n"></span></div>
      <div class="ttl">Shipping Record for the Month of ${esc(monthTitle(rec.month))}</div>
      <div class="rd">Report Date : ${esc(dmy(rec.reportDate))}</div>
    </div>
    <div class="g colhead">
      <div>CMB REF./<br>ORDER NOS</div><div>INV.DATE</div><div class="r">TOTAL<br>AMT$</div><div>CRD<br>TO</div><div class="r">TTL<br>CBM</div><div>VOL<br>UME</div>
      <div>LINE/VESL</div><div class="r">TOT<br>FRT</div><div>FAC</div><div>INV.NR</div><div class="r">AMOUNT</div><div class="r">CBM</div><div class="r">FREIGHT</div><div>TO</div>
      <div class="r">COMM/<br>DISC/VAT</div><div class="r">US$<br>RATE</div><div>CUSDEC<br>NUMBER</div><div>CUSDEC<br>DATE</div><div>PAY<br>TER</div><div>BL/ETA</div>
      <div class="sp2">PORT OF DISCHG.<br>PORT OF DELIVERY</div>
    </div>`

  const rows = rec.rows
    .map((r) => {
      const rs = rupees(r)
      const blEta = [dmy(r.blDate), dmy(r.eta)].filter(Boolean).join(' - ')
      return `
      <div class="blk row" data-total="${num(r.totalAmt)}" data-fac="${esc(r.factory)}" data-amount="${num(r.amount)}" data-frt="${num(r.totFreight)}" data-comm="${num(r.commDiscVat)}">
        <div class="g">
          <div class="b">${esc(r.cmbRefNo)}</div><div>${esc(dmy(r.invDate))}</div><div class="r">${esc(amt(r.totalAmt))}</div><div>${esc(r.creditTo)}</div>
          <div class="r">${esc(plain(r.cbm))}</div><div>${esc(r.volume)}</div><div>${esc(r.line)}</div><div class="r">${esc(plain(r.totFreight))}</div>
          <div>${esc(r.factory)}</div><div>${esc(r.invoiceNo)}</div><div class="r">${esc(amt(r.amount))}</div><div class="r">${esc(plain(r.cbm))}</div>
          <div class="r">${esc(plain(r.freight))}</div><div>${esc(r.freightTo)}</div><div class="r">${esc(plain(r.commDiscVat))}</div>
          <div class="r">${esc(r.usRate)}</div><div>${esc(r.cusdecNo)}</div><div>${esc(dmy(r.cusdecDate))}</div><div>${esc(r.payTerms)}</div>
          <div>${esc(blEta)}</div><div>${esc(r.portDischarge)}</div><div class="r">${rs ? esc(moneyGrouped(rs)) : ''}</div>
        </div>
        <div class="g sub">
          <div class="sp6">${esc(r.orderNo)}</div><div>${esc(r.vessel)}</div><div class="sp13"></div><div class="sp2">${esc(r.portDelivery)}</div>
        </div>
        ${(r.customer.trim() || r.notify.trim()) ? `<div class="nm">${esc(r.customer.trim() || r.notify.trim())}</div>` : ''}
      </div>`
    })
    .join('')

  const totalsLine = (label: string, t: { total: number; fac: Record<string, number>; frt: number; comm: number }) => `
    <div class="tline"><b class="lab">${label} ====&gt;</b><b class="num">${moneyGrouped(t.total)}</b>
      <span>AMP -</span><b class="num">${t.fac.AMP.toFixed(2)}</b>
      <span>AMP-1---&gt;</span><b class="num">${t.fac['AMP-1'].toFixed(2)}</b>
      <span>AMP-2---&gt;</span><b class="num">${t.fac['AMP-2'].toFixed(2)}</b>
      <span>FREIGHT -</span><b class="num">${t.frt.toFixed(2)}</b>
      <span>DIS/COM/VAT -</span><b class="num">${t.comm.toFixed(2)}</b></div>`

  const grand = `<div class="blk tot grand">${totalsLine('GRAND TOTAL', { total: g.total, fac: g.byFactory, frt: g.freight, comm: g.commDiscVat })}</div>`

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(`Shipping Record ${monthTitle(rec.month)}`)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Times New Roman", Times, serif; font-size: 6.6pt; color: #000; }
  .page { width: 297mm; height: 210mm; padding: 10mm 10mm 9mm; display: flex; flex-direction: column; position: relative; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 5mm; }
  .pg { font-size: 9pt; width: 60mm; }
  .ttl { font-size: 13.5pt; flex: 1; text-align: center; }
  .rd { font-size: 9pt; width: 60mm; text-align: right; }
  .g { display: grid; grid-template-columns: 22fr 15fr 15fr 8fr 9fr 10fr 21fr 9fr 9fr 16fr 15fr 8fr 11fr 7fr 12fr 13fr 12fr 15fr 8fr 29fr 22fr 19fr; column-gap: .7mm; }
  .g > div { min-width: 0; overflow-wrap: anywhere; }
  .g .sp2 { grid-column: span 2; }
  .g .sp6 { grid-column: span 6; }
  .g .sp13 { grid-column: span 13; }
  .r { text-align: right; white-space: nowrap; }
  .b { font-weight: bold; }
  .colhead { font-size: 6pt; line-height: 1.5; padding: 1mm 0; border-top: .3mm dashed #000; border-bottom: .3mm dashed #000; }
  .body { flex: 1; min-height: 0; overflow: hidden; padding-top: 3mm; }
  .blk { break-inside: avoid; }
  .row { padding: 1.4mm 0 2.4mm; }
  .row .sub { font-size: 5.8pt; margin-top: .6mm; }
  .row .nm { font-weight: bold; font-size: 6.2pt; margin-top: .8mm; text-transform: uppercase; }
  .tot { border-top: .3mm dashed #000; padding: 2.2mm 0 1.6mm; }
  .tot.grand { border-bottom: .6mm double #000; margin-top: 1mm; }
  .tline { display: flex; align-items: baseline; gap: 3.5mm; font-size: 7pt; white-space: nowrap; }
  .tline .lab { width: 34mm; }
  .tline .num { min-width: 16mm; margin-right: 9mm; font-variant-numeric: tabular-nums; }
  #src { position: absolute; left: -10000px; top: 0; width: 277mm; }
</style></head>
<body>
<div id="src">
  <template id="hd">${header}</template>
  <template id="stl">${totalsLine('SUB TOTAL', { total: 0, fac: { AMP: 0, 'AMP-1': 0, 'AMP-2': 0 }, frt: 0, comm: 0 })}</template>
  ${rows}${grand}
</div>
<script>
(function () {
  var FACS = ${JSON.stringify(FACTORIES)};
  var src = document.getElementById('src');
  var blocks = Array.prototype.slice.call(src.querySelectorAll(':scope > .blk'));
  var pages = [];
  function fmt(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function newPage() {
    var p = document.createElement('div');
    p.className = 'page';
    p.innerHTML = document.getElementById('hd').innerHTML;
    var body = document.createElement('div');
    body.className = 'body';
    p.appendChild(body);
    document.body.insertBefore(p, src);
    pages.push(p);
    return body;
  }
  /** SUB TOTAL of the rows on one page */
  function subTotal(body) {
    var t = { total: 0, frt: 0, comm: 0, fac: {} };
    FACS.forEach(function (f) { t.fac[f] = 0; });
    Array.prototype.forEach.call(body.querySelectorAll('.row'), function (r) {
      t.total += +r.dataset.total; t.frt += +r.dataset.frt; t.comm += +r.dataset.comm;
      var f = FACS.indexOf(r.dataset.fac) >= 0 ? r.dataset.fac : 'AMP';
      t.fac[f] += +r.dataset.amount;
    });
    var d = document.createElement('div');
    d.className = 'blk tot';
    d.innerHTML = document.getElementById('stl').innerHTML;
    var nums = d.querySelectorAll('.num');
    nums[0].textContent = fmt(t.total);
    nums[1].textContent = t.fac['AMP'].toFixed(2);
    nums[2].textContent = t.fac['AMP-1'].toFixed(2);
    nums[3].textContent = t.fac['AMP-2'].toFixed(2);
    nums[4].textContent = t.frt.toFixed(2);
    nums[5].textContent = t.comm.toFixed(2);
    return d;
  }
  var over = function (body) { return body.scrollHeight > body.clientHeight + 1; };
  var body = newPage();
  blocks.forEach(function (b) {
    // every block must leave room for this page's SUB TOTAL (it goes under the rows, before the GRAND TOTAL)
    var probe = subTotal(body);
    body.appendChild(probe);
    body.appendChild(b);
    var tooBig = over(body);
    body.removeChild(probe);
    if (tooBig && body.children.length > 1) {
      body.removeChild(b);
      body.appendChild(subTotal(body));
      body = newPage();
      body.appendChild(b);
    }
  });
  // the last page: SUB TOTAL before the GRAND TOTAL
  var grand = body.querySelector('.grand');
  if (grand && body.querySelector('.row')) body.insertBefore(subTotal(body), grand);
  pages.forEach(function (p, i) {
    p.querySelector('.pg .n').textContent = String(i + 1);
    // the column titles only on pages that have invoice rows (not on a GRAND TOTAL page)
    if (!p.querySelector('.body .row')) { var ch = p.querySelector('.colhead'); if (ch) ch.parentNode.removeChild(ch); }
  });
  src.parentNode.removeChild(src);
  window.__pageCount = pages.length;
  window.__paginated = true;
})();
</script>
</body></html>`
}
