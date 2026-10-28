/**
 * The commercial invoice as an A4 HTML page, in the layout of the old FoxPro printout
 * (COMMERCIAL INVOICE NO : M/23/002, pages 1 and 2).
 *
 * Every page repeats: Page : n, the company block, the invoice no / date, the consignee and the
 * vessel block, the ASN no and the column titles. The body flows over the pages: the PI block, one
 * block per item (never split), then the totals and the closing blocks. A small script in the page
 * does the page breaks after layout and sets window.__paginated when done (see render.ts).
 */
import {
  amountInWords, dmy, invoiceSums, invoiceTotals, longDate, moneyGrouped, num, splitColour, unitWord,
  type CommercialInvoice
} from '@shared/invoice'
import type { CompanyDetails } from '@shared/types'

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Multi-line text with line breaks kept. */
const ml = (s: string) => esc(s.replace(/\s+$/, '')).replace(/\r?\n/g, '<br>')

const qtyText = (q: string, unit: Parameters<typeof unitWord>[0]) => (q.trim() ? `${esc(q.trim())} ${unitWord(unit, true)}` : '')
const priceText = (p: string, unit: Parameters<typeof unitWord>[0]) => (p.trim() ? `${esc(p.trim())}/${unitWord(unit, false)}` : '')
const amount = (t: string) => (t.trim() ? num(t).toFixed(2) : '')

export function invoiceHtml(company: CompanyDetails, ci: CommercialInvoice): string {
  const t = invoiceTotals(ci.lines)
  const sums = invoiceSums(ci)
  const words = ci.amountWords.trim() || amountInWords(sums.total, ci.currency)

  const header = (first: boolean) => `
    <div class="pgno">Page : <span class="n"></span></div>
    ${first && company.headerNote.trim() ? `<div class="note">${esc(company.headerNote)}</div>` : ''}
    <div class="co">${esc(company.name)}</div>
    <div class="addr">${esc(company.address)}</div>
    <div class="tel">${esc(company.telFax)}</div>
    <div class="hdr">
      <div class="left">
        <div class="cino">COMMERCIAL INVOICE NO : ${esc(ci.invoiceNo)}</div>
        <div class="cons">
          <div class="lbl">Consignee /Notify</div>
          <div class="to"><span class="tolbl">To : M/S.</span><span class="toval">${ml(ci.consignee)}</span></div>
        </div>
      </div>
      <div class="right">
        <div class="date">DATE : ${esc(longDate(ci.date))}</div>
        <table class="kv">
          <tr><td>Vessel</td><td>: ${esc(ci.vessel)}</td></tr>
          <tr><td>Voyage</td><td>: ${esc(ci.voyage)}</td></tr>
          <tr><td>ETD-ETA</td><td>: ${esc([dmy(ci.etd), dmy(ci.eta)].filter(Boolean).join(' - '))}</td></tr>
          <tr><td>Container No</td><td>: ${esc(ci.containerNo)}</td></tr>
          <tr><td>Container seal No</td><td>: ${esc(ci.sealNo)}</td></tr>
          <tr><td>Payment Terms</td><td>: ${esc(ci.paymentTerms)}</td></tr>
        </table>
      </div>
    </div>
    <div class="asn">ASN NO : ${esc(ci.asnNo)}</div>
    <div class="g colhead">
      <div>YOUR<br>ITEM NO</div><div>OUR<br>ITEM NO</div><div>COLOR<br>CODE</div><div class="desc"><br>DESCRIPTION</div>
      <div>NO OF<br>CTNS/PKGS</div><div>QUANTITY<br>SHIPPED</div><div>PRICE<br>US$ / UNIT</div><div class="tot">FOB COLOMBO<br>SRI LANKA<br>TOTAL/US$</div>
    </div>`

  const piBlock = `
    <div class="blk pi">
      <div class="goods">${esc(ci.goodsTitle)}</div>
      <table class="pit">
        <tr><th>PI NO</th><th>PO NO</th><th>POD</th><th>TYPE</th><th>CURRENCY</th><th>AMOUNT</th></tr>
        <tr><td>${esc(ci.piLabel || ci.piNo)}</td><td>${esc(ci.poNo)}</td><td>${esc(ci.pod)}</td><td>${esc(ci.type)}</td><td>${esc(ci.currency)}</td><td>${esc(moneyGrouped(sums.total))}</td></tr>
      </table>
      ${ci.incoterms.trim() ? `<div class="b">${esc(ci.incoterms)}</div>` : ''}
      ${ci.terms.trim() ? `<div class="b">${esc(ci.terms)}</div>` : ''}
    </div>`

  const lineBlocks = ci.lines
    .map((l) => {
      const c = splitColour(l.colour)
      const barcode = l.barcode.trim() ? `BARCODE#${esc(l.barcode.trim())}` : ''
      const row3Desc = c.detail ? esc(c.detail) : barcode
      const row4 = c.detail && barcode
      return `
      <div class="blk item">
        <div class="g r1"><div>${esc(l.yourItemNo)}</div><div class="span7"><span class="oi">${esc(l.ourItem)}</span> ${esc(l.description)}</div></div>
        ${l.factory.trim() || l.packing.trim() ? `<div class="g"><div></div><div>${esc(l.factory)}</div><div class="span2">${esc(l.packing)}</div><div></div><div></div><div></div><div></div></div>` : ''}
        <div class="g"><div></div><div>${l.hsCode.trim() ? `H.S Code ${esc(l.hsCode)}` : ''}</div><div>${esc(c.code)}</div><div>${row3Desc}</div>
          <div class="num">${esc(l.ctns)}</div><div class="num">${qtyText(l.qty, l.unit)}</div><div class="num">${priceText(l.price, l.unit)}</div><div class="num">${esc(amount(l.total))}</div></div>
        ${row4 ? `<div class="g"><div></div><div></div><div></div><div>${barcode}</div><div></div><div></div><div></div><div></div></div>` : ''}
      </div>`
    })
    .join('')

  const qtyTotal = t.byUnit.map((u) => `${u.qty} ${u.unit}`).join('<br>')
  const totalsBlock = `
    <div class="blk totals">
      <div class="g trow"><div class="tl">TOTALS :</div><div></div><div></div><div></div>
        <div class="num">${t.ctns || ''}</div><div class="num">${qtyTotal}</div><div class="num cur">US$</div><div class="num ${sums.hasDiscount ? 'st' : 'gt'}">${esc(sums.subtotal.toFixed(2))}</div></div>
      <div class="g"><div></div><div></div><div></div><div></div><div class="num">Cartons</div><div></div><div></div><div></div></div>
      ${sums.hasDiscount ? `
      <div class="g drow"><div></div><div></div><div></div><div class="dl">${esc(ci.discountLabel.trim() || 'LESS : DISCOUNT')}${sums.percentText ? ` (${esc(sums.percentText)})` : ''}</div>
        <div></div><div></div><div class="num cur">US$</div><div class="num">(${esc(sums.discount.toFixed(2))})</div></div>
      <div class="g trow nrow"><div class="tl">NET TOTAL :</div><div></div><div></div><div></div>
        <div></div><div></div><div class="num cur">US$</div><div class="num gt">${esc(sums.total.toFixed(2))}</div></div>` : ''}
      <div class="tlabel">${esc(ci.totalsLabel)}</div>
      <div class="say"><b>Say :</b> ${esc(words)}</div>
    </div>`

  const marks = ci.shippingMarks.trim() || ci.orderReference.trim()
    ? `<div class="blk marks">
        ${ci.shippingMarks.trim() ? `<div class="mk"><b>Shipping Marks :</b> <span>${ml(ci.shippingMarks)}</span></div>` : ''}
        ${ci.orderReference.trim() ? `<div class="mk"><b>Applicant's Order reference :</b> <span>${ml(ci.orderReference)}</span></div>` : ''}
      </div>`
    : ''

  const certLines = ci.certify.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const certify = certLines.length
    ? `<div class="blk cert"><div class="ch">We hereby certify that</div><div class="cl">${certLines
        .map((x, i) => `<div><span class="cn">${String.fromCharCode(97 + i)})</span>${esc(x)}</div>`)
        .join('')}</div></div>`
    : ''

  const hs = ci.hsNote.trim() ? `<div class="blk hsn">${ml(ci.hsNote)}</div>` : ''

  const bene = `
    <div class="blk bene">
      <div class="bh">Beneficiary</div>
      <div class="bcols"><div class="bl">${ml(ci.beneficiary)}</div><div class="br">${ml(ci.bank)}</div></div>
    </div>`

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(ci.invoiceNo || 'Commercial invoice')}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8.6pt; color: #000; }
  .page { width: 210mm; height: 297mm; padding: 9mm 11mm 9mm 11mm; display: flex; flex-direction: column; position: relative; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .serif, .note, .co, .addr, .tel, .hdr, .asn, .colhead, .pi, .totals, .marks, .cert, .hsn, .bene { font-family: "Times New Roman", Times, serif; }
  .pgno { position: absolute; top: 9mm; right: 11mm; font-weight: bold; font-size: 10pt; font-family: "Times New Roman", serif; }
  .note { text-align: center; font-weight: bold; font-size: 9.5pt; margin-top: 4mm; }
  .co { text-align: center; font-weight: bold; font-size: 15pt; letter-spacing: .3px; margin-top: 1mm; }
  .page:not(.first) .co { margin-top: 5mm; }
  .addr { text-align: center; font-weight: bold; font-size: 8.4pt; margin-top: 2.5mm; }
  .tel { text-align: center; font-weight: bold; font-size: 8.4pt; }
  .hdr { display: flex; justify-content: space-between; margin-top: 7mm; font-weight: bold; font-size: 9pt; }
  .hdr .left { width: 56%; }
  .hdr .right { width: 42%; }
  .cino { font-size: 9.5pt; }
  .cons { margin-top: 5mm; }
  .cons .lbl { font-size: 9pt; }
  .to { display: flex; gap: 1.5mm; }
  .tolbl { white-space: nowrap; }
  .toval { text-transform: uppercase; line-height: 1.35; }
  .date { font-size: 9.5pt; }
  .kv { border-collapse: collapse; margin-top: 3mm; }
  .kv td { padding: 0 0 .6mm 0; vertical-align: top; font-weight: bold; }
  .kv td:first-child { padding-right: 2mm; white-space: nowrap; }
  .asn { margin-top: 5mm; font-weight: bold; font-size: 8.6pt; border-bottom: .3mm solid #000; padding-bottom: .5mm; }
  .g { display: grid; grid-template-columns: 19mm 22mm 22mm 1fr 17mm 19mm 16mm 20mm; column-gap: 1.2mm; }
  .g > div { min-width: 0; overflow-wrap: anywhere; }
  .g .span7 { grid-column: span 7; }
  .g .span2 { grid-column: span 2; }
  .colhead { font-size: 6.6pt; font-weight: bold; padding: 1mm 0 .8mm; border-bottom: .3mm solid #000; line-height: 1.15; align-items: end; }
  .colhead .tot { text-align: right; }
  .colhead div:nth-child(n+5) { text-align: right; }
  .colhead .desc { padding-left: 4mm; }
  .body { flex: 1; min-height: 0; overflow: hidden; padding-top: 2.5mm; }
  .blk { break-inside: avoid; }
  .pi { margin: 2mm 0 5mm; font-weight: bold; font-size: 8.6pt; }
  .pit { border-collapse: collapse; margin-top: 1mm; }
  .pit th, .pit td { text-align: left; padding: 0 9mm .4mm 0; font-size: 8.6pt; }
  .pit td:last-child { text-align: left; }
  .pi .b { margin-top: .3mm; }
  .item { margin-bottom: 4.2mm; font-size: 7.8pt; line-height: 1.3; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 1mm; border-top: .3mm solid #000; padding-top: 1.5mm; font-size: 8.6pt; }
  .totals .trow { font-weight: bold; }
  .totals .gt { border-bottom: .6mm double #000; }
  .totals .st { border-bottom: .3mm solid #000; }
  .totals .drow { margin-top: 1.5mm; font-weight: bold; }
  .totals .drow .dl { text-align: right; padding-right: 2mm; }
  .totals .nrow { margin-top: 1.5mm; }
  .totals .cur { text-align: right; }
  .tlabel { text-align: right; font-weight: bold; margin-top: 2mm; }
  .say { margin-top: 4mm; font-size: 9.2pt; font-weight: bold; }
  .marks { margin-top: 5mm; font-weight: bold; font-size: 9pt; }
  .mk { margin: 0 0 2mm 9mm; display: flex; gap: 1.5mm; }
  .mk b { white-space: nowrap; }
  .cert { margin-top: 4mm; display: flex; gap: 6mm; font-size: 9pt; font-weight: bold; }
  .cert .ch { white-space: nowrap; }
  .cert .cl div { margin-bottom: .4mm; }
  .cert .cn { display: inline-block; width: 6mm; }
  .hsn { margin-top: 5mm; font-weight: bold; font-size: 9.2pt; }
  .bene { margin-top: 6mm; font-weight: bold; font-size: 8.8pt; }
  .bene .bh { font-size: 9.5pt; }
  .bcols { display: flex; justify-content: space-between; margin-top: 1mm; line-height: 1.35; }
  .bcols .bl { width: 50%; padding-left: 9mm; }
  .bcols .br { width: 46%; }
  #src { position: absolute; left: -10000px; top: 0; width: 188mm; }
</style></head>
<body>
<div id="src">
  <template id="h1">${header(true)}</template>
  <template id="hn">${header(false)}</template>
  ${piBlock}${lineBlocks}${totalsBlock}${marks}${certify}${hs}${bene}
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
