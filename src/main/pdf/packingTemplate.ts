/**
 * The packing / weight list as an A4 HTML page, in the layout of the old printout
 * (PACKING/WEIGHT LIST for COMMERCIAL INVOICE NO : M/23/002).
 *
 * Every page repeats the company block, invoice no / date, consignee / shipping marks, the vessel
 * block, the title, the ASN no and the column titles. The body (PI block, one row per item, totals
 * and the weight summary) flows over the pages like the invoice (see invoiceTemplate.ts).
 */
import { dmy, longDate, moneyGrouped, num } from '@shared/invoice'
import { lineCbm, measureText, packingTotals, unitsText, type PackingList } from '@shared/packing'
import type { CompanyDetails } from '@shared/types'

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const ml = (s: string) => esc(s.replace(/\s+$/, '')).replace(/\r?\n/g, '<br>')

const kg = (n: number) => `${n.toFixed(2)}kgs`

export function packingHtml(company: CompanyDetails, pl: PackingList): string {
  const t = packingTotals(pl.lines)

  const header = (first: boolean) => `
    <div class="pgno">Page : <span class="n"></span></div>
    ${first && company.headerNote.trim() ? `<div class="note">${esc(company.headerNote)}</div>` : ''}
    <div class="co">${esc(company.name)}</div>
    <div class="addr">${esc(company.address)}</div>
    <div class="tel">${esc(company.telFax)}</div>
    ${company.email?.trim() ? `<div class="tel">Email : ${esc(company.email)}</div>` : ''}
    <div class="hdr">
      <div class="left">
        <div class="cino">COMMERCIAL INVOICE NO : ${esc(pl.invoiceNo)}</div>
        <div class="cons">
          <div class="lbl">Consignee /Notify</div>
          <div class="to"><span class="tolbl">To : M/S.</span><span class="toval">${ml(pl.consignee)}</span></div>
        </div>
        <table class="kv">
          <tr><td>Vessel</td><td>: ${esc(pl.vessel)}</td></tr>
          <tr><td>Voyage</td><td>: ${esc(pl.voyage)}</td></tr>
          <tr><td>ETD-ETA</td><td>: ${esc([dmy(pl.etd), dmy(pl.eta)].filter(Boolean).join(' - '))}</td></tr>
          <tr><td>Container No</td><td>: ${esc(pl.containerNo)}</td></tr>
          <tr><td>Container seal No</td><td>: ${esc(pl.sealNo)}</td></tr>
          <tr><td>Payment Terms</td><td>: ${esc(pl.paymentTerms)}</td></tr>
        </table>
      </div>
      <div class="right">
        <div class="date">DATE : ${esc(longDate(pl.date))}</div>
        <div class="smh">SHIPPING MARKS :</div>
        <div class="sm">${ml(pl.shippingMarks)}</div>
      </div>
    </div>
    <div class="title">PACKING / WEIGHT LIST</div>
    <div class="asn">ASN NO : ${esc(pl.asnNo)}</div>
    <div class="g colhead">
      <div>ITEM NO</div><div>COLOR<br>CODE</div><div>CUSTOMER<br>ITEM NO</div><div class="c">CTN-NO</div><div class="c">PACKING</div>
      <div class="r">NO OF<br>CTNS/<br>PKGS</div><div class="r">NO OF<br>UNITS</div><div class="r">NETT<br>WT/CTN<br>(kgs)</div><div class="r">GROSS<br>WT/CTN<br>(kgs)</div>
      <div class="r">TOTAL<br>CBM</div><div class="c">MEASUREMENTS<br>CM</div>
    </div>`

  const piBlock = `
    <div class="blk pi">
      <div class="goods">${esc(pl.goodsTitle)}</div>
      <table class="pit">
        <tr><th>PI NO</th><th>PO NO</th><th>POD</th><th>TYPE</th><th>CURRENCY</th><th>AMOUNT</th></tr>
        <tr><td>${esc(pl.piLabel || pl.piNo)}</td><td>${esc(pl.poNo)}</td><td>${esc(pl.pod)}</td><td>${esc(pl.type)}</td><td>${esc(pl.currency)}</td><td>${pl.amount.trim() ? esc(moneyGrouped(num(pl.amount))) : ''}</td></tr>
      </table>
      ${pl.incoterms.trim() ? `<div class="b">${esc(pl.incoterms)}</div>` : ''}
      ${pl.terms.trim() ? `<div class="b">${esc(pl.terms)}</div>` : ''}
    </div>`

  const rows = pl.lines
    .map((l) => {
      const cbm = lineCbm(l)
      return `
      <div class="blk g item">
        <div class="sm7">${esc(l.itemNo)}</div><div>${esc(l.colour)}</div><div>${esc(l.customerItemNo)}</div><div class="c">${esc(l.ctnNo)}</div>
        <div class="c">${esc(l.packing)}</div><div class="r">${esc(l.ctns)}</div><div class="r">${esc(unitsText(l))}</div>
        <div class="r">${esc(l.nettCtn)}</div><div class="r">${esc(l.grossCtn)}</div><div class="r">${cbm ? cbm.toFixed(2) : ''}</div>
        <div class="r">${esc(measureText(l))}</div>
      </div>`
    })
    .join('')

  const units = t.byUnit.map((u) => `${u.qty} ${u.unit}`).join('<br>')
  const totals = `
    <div class="blk totals">
      <div class="g trow"><div class="tl">TOTALS :</div><div></div><div></div><div></div><div></div>
        <div class="r">${t.ctns || ''}</div><div class="r">${units}</div><div></div><div></div><div class="r">${t.cbm ? t.cbm.toFixed(2) : ''}</div><div></div></div>
      <div class="g trow2"><div></div><div></div><div></div><div></div><div></div>
        <div class="r">Cartons</div><div></div><div class="r">${kg(t.nett)}</div><div class="r">${kg(t.gross)}</div><div></div><div></div></div>
    </div>`

  const summary = `
    <div class="blk wsum">
      <table>
        <tr><td>TOTAL GROSS WEIGHT</td><td class="r">${moneyGrouped(t.gross)}</td></tr>
        <tr><td>TOTAL NETT WEIGHT</td><td class="r">${moneyGrouped(t.nett)}</td></tr>
        <tr class="diff"><td>DIFFERENCE</td><td class="r"><span>${moneyGrouped(t.difference)}</span></td></tr>
      </table>
    </div>`

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(`Packing list ${pl.invoiceNo}`)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Times New Roman", Times, serif; font-size: 8.4pt; color: #000; }
  .page { width: 210mm; height: 297mm; padding: 9mm 10mm; display: flex; flex-direction: column; position: relative; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .pgno { position: absolute; top: 9mm; right: 10mm; font-weight: bold; font-size: 10pt; }
  .note { text-align: center; font-weight: bold; font-size: 9.5pt; margin-top: 4mm; }
  .co { text-align: center; font-weight: bold; font-size: 15pt; letter-spacing: .3px; margin-top: 1mm; }
  .page:not(.first) .co { margin-top: 5mm; }
  .addr { text-align: center; font-size: 8.4pt; margin-top: 2.5mm; }
  .tel { text-align: center; font-size: 8.4pt; }
  .hdr { display: flex; justify-content: space-between; margin-top: 6mm; font-weight: bold; font-size: 9pt; }
  .hdr .left { width: 60%; }
  .hdr .right { width: 36%; }
  .cino { font-size: 9.5pt; }
  .cons { margin-top: 5mm; }
  .to { display: flex; gap: 1.5mm; }
  .tolbl { white-space: nowrap; }
  .toval { text-transform: uppercase; line-height: 1.35; }
  .kv { border-collapse: collapse; margin-top: 5mm; }
  .kv td { padding: 0 0 .6mm 0; vertical-align: top; font-weight: bold; }
  .kv td:first-child { padding-right: 2mm; white-space: nowrap; }
  .date { font-size: 9.5pt; }
  .smh { margin-top: 5mm; }
  .sm { margin-top: 5mm; line-height: 1.35; }
  .title { text-align: center; font-weight: bold; font-size: 12pt; letter-spacing: 2.5px; margin-top: 3mm; }
  .asn { margin-top: 2mm; font-weight: bold; font-size: 8.6pt; border-bottom: .3mm solid #000; padding-bottom: .5mm; }
  .g { display: grid; grid-template-columns: 24mm 21mm 15mm 13mm 11mm 10mm 15mm 14mm 14mm 11mm 1fr; column-gap: 1.1mm; }
  .g > div { min-width: 0; overflow-wrap: anywhere; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; }
  .colhead { font-family: Arial, Helvetica, sans-serif; font-size: 6pt; padding: 1mm 0 .8mm; border-bottom: .3mm solid #000; line-height: 1.2; align-items: end; }
  .body { flex: 1; min-height: 0; overflow: hidden; padding-top: 2.5mm; }
  .blk { break-inside: avoid; }
  .pi { margin: 2mm 0 4mm; font-weight: bold; font-size: 8.6pt; }
  .pit { border-collapse: collapse; margin-top: 1mm; }
  .pit th, .pit td { text-align: left; padding: 0 9mm .4mm 0; font-size: 8.6pt; }
  .item { font-size: 7.8pt; padding: .9mm 0; }
  .item .sm7 { font-size: 6.4pt; padding-top: .3mm; }
  .totals { margin-top: 2mm; border-top: .3mm solid #000; padding-top: 1.5mm; font-size: 8.4pt; }
  .totals .trow { font-weight: bold; }
  .totals .trow2 { margin-top: 1mm; font-size: 8pt; }
  .wsum { margin-top: 12mm; font-size: 12pt; }
  .wsum table { border-collapse: collapse; }
  .wsum td { padding: .4mm 0; }
  .wsum td:first-child { width: 62mm; }
  .wsum td.r { width: 30mm; }
  .wsum .diff td { font-weight: bold; padding-top: 6mm; }
  .wsum .diff td.r span { display: inline-block; border-top: .4mm solid #000; border-bottom: 1mm double #000; padding: .8mm 0 .4mm 6mm; }
  #src { position: absolute; left: -10000px; top: 0; width: 190mm; }
</style></head>
<body>
<div id="src">
  <template id="h1">${header(true)}</template>
  <template id="hn">${header(false)}</template>
  ${piBlock}${rows}${totals}${summary}
</div>
<script>
(function () {
  var src = document.getElementById('src');
  var blocks = Array.prototype.slice.call(src.querySelectorAll(':scope > .blk'));
  var pages = [];
  function newPage() {
    var p = document.createElement('div');
    p.className = 'page' + (pages.length ? '' : ' first');
    p.innerHTML = document.getElementById(pages.length ? 'hn' : 'h1').innerHTML;
    var body = document.createElement('div');
    body.className = 'body';
    p.appendChild(body);
    document.body.insertBefore(p, src);
    pages.push(p);
    return body;
  }
  var body = newPage();
  blocks.forEach(function (b) {
    body.appendChild(b);
    if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1) {
      body.removeChild(b);
      body = newPage();
      body.appendChild(b);
    }
  });
  pages.forEach(function (p, i) { p.querySelector('.pgno .n').textContent = String(i + 1); });
  src.parentNode.removeChild(src);
  window.__pageCount = pages.length;
  window.__paginated = true;
})();
</script>
</body></html>`
}
