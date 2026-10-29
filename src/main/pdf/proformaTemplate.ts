/**
 * A proforma invoice from the Product Management App, printed in that app's own layout (2 pages), so the
 * shipping manager can download / print a PI from the shared database without the planning PC's files.
 * The layout follows Photo_Quotation_Generator/src/main/pdf/proformaTemplate.ts. Company and bank details
 * come from this app's Settings (the planning app's settings stay on the planning PC).
 */
import type { CompanyDetails } from '@shared/types'
import type { PmaProforma } from '@shared/proforma'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const text = (s: unknown) => esc(s).trim().replace(/\r?\n/g, '<br>')
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (s: unknown) => {
  const n = Number(str(s).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-28" → "Sep 28,2026", as on the printed sheet. */
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])},${m[1]}` : iso
}

const FINAL_CLAUSE =
  'Provided the vessel and spaces nominated by buyer are available to the shipper to effect the shipment, any delays or changes of the shipment dates caused by the non availability of the spaces or vessel as advised by the buyer and or buyers nominated freight forwarder at the origin port of the shipment, shipper cannot be held responsible.'

type Unit = 'PCS' | 'DOZ' | 'SETS'
interface Line {
  yourItemNo: string; ourItem: string; ourFactory: string; colorCode: string; description: string
  noCtns: string; qty: string; unit: Unit; price: string; total: string; cft: string
}
interface Marks {
  mode: 'fields' | 'images'; shipMark: string; cartonNo: string; images: string[]
  side: { itemNo: string; qty: string; colourAsst: string; nw: string; gw: string }
  inner: { itemNo: string; colourAsst: string; qty: string }
}

/** The stored proforma with every field the layout needs (older saves may miss some). */
function normalize(pf: PmaProforma) {
  const raw = pf as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const h = raw.header ?? {}
  const c = h.customer ?? {}
  const g = raw.page2 ?? {}
  const m = g.marks ?? {}
  const lines: Line[] = (Array.isArray(raw.lines) ? raw.lines : []).map((l: Record<string, unknown>) => {
    const unit = str(l.unit).toUpperCase()
    const qty = str(l.qty)
    const price = str(l.price)
    return {
      yourItemNo: str(l.yourItemNo), ourItem: str(l.ourItem), ourFactory: str(l.ourFactory), colorCode: str(l.colorCode),
      description: str(l.description), noCtns: str(l.noCtns), qty, unit: (unit === 'DOZ' || unit === 'SETS' ? unit : 'PCS') as Unit,
      price, total: str(l.total) || (qty && price ? (num(qty) * num(price)).toFixed(2) : ''), cft: str(l.cft)
    }
  })
  const marks: Marks = {
    mode: m.mode === 'images' ? 'images' : 'fields',
    shipMark: str(m.shipMark), cartonNo: m.cartonNo == null ? 'C/NO. 1 and up.' : str(m.cartonNo),
    images: Array.isArray(m.images) ? m.images.filter((x: unknown) => typeof x === 'string' && x.startsWith('data:image/')) : [],
    side: { itemNo: str(m.side?.itemNo), qty: str(m.side?.qty), colourAsst: str(m.side?.colourAsst), nw: str(m.side?.nw), gw: str(m.side?.gw) },
    inner: { itemNo: str(m.inner?.itemNo), colourAsst: str(m.inner?.colourAsst), qty: str(m.inner?.qty) }
  }
  return {
    invoiceNo: str(h.invoiceNo), date: str(h.date), ref: str(h.ref),
    customer: { name: str(c.name), street1: str(c.street1), street2: str(c.street2), city: str(c.city), country: str(c.country), phone: str(c.phone), email: str(c.email), attention: str(c.attention) },
    lines,
    page2: {
      container: str(g.container), fromPort: str(g.fromPort) || 'Colombo, Sri Lanka', toPort: str(g.toPort), latestShipment: str(g.latestShipment),
      originCert: str(g.originCert) || 'G.S.P. Form A of "Made in Sri Lanka" will be supplied', marks,
      originOnGoods: g.originOnGoods !== false, originOnInnerboxes: g.originOnInnerboxes !== false, originOnCartons: g.originOnCartons !== false,
      specialMarks: str(g.specialMarks), specialLabels: g.specialLabels !== false,
      specialLabelItems: (Array.isArray(g.specialLabelItems) ? g.specialLabelItems.map(str) : []) as string[],
      forwardingAgent: !!g.forwardingAgent, forwardingAgentName: str(g.forwardingAgentName),
      clauses: (Array.isArray(g.clauses) ? g.clauses.map(str) : []) as string[]
    }
  }
}
type P = ReturnType<typeof normalize>

function totals(lines: Line[]) {
  const by = new Map<Unit, number>()
  let ctns = 0
  let amount = 0
  let cft = 0
  for (const l of lines) {
    ctns += num(l.noCtns)
    by.set(l.unit, (by.get(l.unit) ?? 0) + num(l.qty))
    amount += num(l.total)
    cft += num(l.cft) * num(l.noCtns)
  }
  return {
    ctns,
    byUnit: (['PCS', 'DOZ', 'SETS'] as Unit[]).filter((u) => by.has(u)).map((u) => ({ unit: u, qty: by.get(u)! })),
    amount: amount.toFixed(2),
    cft: cft ? String(Math.round(cft)) : ''
  }
}

const CSS = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 8pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; min-height: 297mm; padding: 10mm 12mm; position: relative; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.chead { text-align: center; }
.chead .name { font-weight: bold; font-size: 12pt; letter-spacing: .3px; }
.chead .line { font-size: 8.5pt; }
.toprow { display: flex; justify-content: space-between; margin-top: 6mm; font-size: 9pt; }
.toprow .no { font-weight: bold; font-size: 10pt; }
.to { margin-top: 3mm; font-size: 9pt; line-height: 1.35; }
.to .name { font-weight: bold; }
.to .country { font-weight: bold; }
.contact { display: flex; gap: 14mm; margin-top: 2mm; font-size: 9pt; }
.attn { font-weight: bold; margin-top: 3.5mm; font-size: 9pt; }
.ref { margin-top: 3mm; font-size: 9pt; }
.datepage div + div { margin-top: 2.5mm; }
.colr { text-align: center; margin-top: 1mm; }
table.items { width: 100%; border-collapse: collapse; margin-top: 3mm; table-layout: fixed; }
table.items th { border-bottom: 1px solid #000; border-top: 1px solid #000; font-size: 7.5pt; padding: 1mm 1mm; text-align: left; vertical-align: top; font-weight: bold; }
table.items td { font-size: 7.6pt; padding: 1.4mm 1mm; vertical-align: top; }
table.items td.c, table.items th.c { text-align: center; }
table.items td.r, table.items th.r { text-align: right; }
.itemno { font-weight: bold; }
tr.totrow td { border-top: 1px solid #000; padding-top: 1.5mm; font-weight: bold; }
.fobfoot { text-align: right; font-weight: bold; margin-top: 8mm; font-size: 10pt; }
.p2head { font-weight: bold; font-size: 10pt; margin-top: 4mm; }
ol.terms { margin: 3mm 0 0; padding-left: 7mm; font-size: 9pt; line-height: 1.4; }
ol.terms > li { margin-bottom: 1.5mm; }
.sub { list-style: none; padding-left: 4mm; margin: 1mm 0 0; }
.sub li { margin-bottom: .6mm; }
.bank { font-size: 9pt; margin: 2mm 0 0 4mm; line-height: 1.35; }
.bank div { white-space: pre-wrap; }
.bank .b { font-weight: bold; }
li.ship { margin-top: 4mm; }
li.made { margin-top: 4mm; }
.cno { margin-top: 2.5mm; margin-bottom: 2mm; font-weight: bold; }
table.marks { border-collapse: collapse; margin: 2mm 0 0 0; font-size: 8.5pt; width: 100%; }
table.marks td { border: 1px solid #000; padding: 1.5mm 2mm; vertical-align: top; width: 33%; }
.markimg { display: flex; gap: 4mm; flex-wrap: wrap; margin-top: 2mm; }
.markimg img { max-width: 60mm; max-height: 45mm; border: 1px solid #ccc; }
.yn { font-weight: bold; }
`

const yn = (b: boolean) => (b ? 'YES' : 'NO')

function header(company: CompanyDetails, invoiceNo: string, date: string, page: number): string {
  return `<div class="chead">
      <div class="name">${text(company.name)}</div>
      <div class="line">${text(company.address)}</div>
      <div class="line">${text(company.telFax)}</div>
      ${company.email?.trim() ? `<div class="line">E-MAIL : ${text(company.email)}</div>` : ''}
    </div>
    <div class="toprow">
      <div class="no">PROFORMA INVOICE NO : ${text(invoiceNo)}</div>
      <div class="datepage"><div>DATE : ${esc(formatDate(date))}</div><div>PAGE : ${page}</div></div>
    </div>`
}

function page1(company: CompanyDetails, p: P): string {
  const c = p.customer
  const t = totals(p.lines)
  // the first line of the description (name + size) prints bold; the packing line stays normal
  const describe = (d: string): string => {
    const lines = d.trim().split(/\r?\n/)
    if (!lines[0]) return ''
    return lines.map((ln, i) => (i === 0 ? `<b>${esc(ln)}</b>` : esc(ln))).join('<br>')
  }
  const rows = p.lines
    .map(
      (l, i) => `<tr>
        <td class="c">${esc(l.yourItemNo.trim() || String(i + 1).padStart(2, '0'))}</td>
        <td><div class="itemno">${text(l.ourItem)}</div>${l.ourFactory.trim() ? `<div>${text(l.ourFactory)}</div>` : ''}</td>
        <td colspan="2">${describe(l.description)}${l.colorCode.trim() ? `<div class="colr">${text(l.colorCode)}</div>` : ''}</td>
        <td class="c">${text(l.noCtns)}</td>
        <td class="c">${text(l.qty)}${l.qty.trim() ? ` ${esc(l.unit.toLowerCase())}` : ''}</td>
        <td class="r">${text(l.price)}${l.price.trim() ? '/' + esc(l.unit === 'PCS' ? 'pc' : l.unit.toLowerCase()) : ''}</td>
        <td class="r">${text(l.total)}</td>
      </tr>`
    )
    .join('')
  const unitTotals = t.byUnit.map((u) => `${u.qty.toLocaleString('en-US')} ${u.unit}`).join('<br>')
  return `<div class="page">
    ${header(company, p.invoiceNo, p.date, 1)}
    <div class="to">
      <div><b>TO :</b> <span class="name">${text(c.name)}</span></div>
      ${[c.street1, c.street2, c.city].filter((x) => x.trim()).map((x) => `<div>${text(x)}</div>`).join('')}
      ${c.country.trim() ? `<div class="country">${text(c.country)}</div>` : ''}
    </div>
    <div class="contact">
      ${c.phone.trim() ? `<div>TEL : ${text(c.phone)}</div>` : ''}
      ${c.email.trim() ? `<div>E-MAIL : ${text(c.email)}</div>` : ''}
    </div>
    ${c.attention.trim() ? `<div class="attn">ATTN ${text(c.attention)}</div>` : ''}
    ${p.ref.trim() ? `<div class="ref">${text(p.ref)}</div>` : ''}
    <table class="items">
      <colgroup><col style="width:8%"><col style="width:15%"><col style="width:12%"><col style="width:29%"><col style="width:8%"><col style="width:10%"><col style="width:9%"><col style="width:9%"></colgroup>
      <thead><tr>
        <th>YOUR ITEM NO</th><th>OUR ITEM NO</th><th>COLOR CODE</th><th>DESCRIPTION</th>
        <th class="c">NO OF CTNS</th><th class="c">QUANTITY ORDERED</th><th class="r">PRICE FOB COLOMBO US$/UNIT</th><th class="r">TOTAL US$</th>
      </tr></thead>
      <tbody>
        ${rows}
        <tr class="totrow">
          <td colspan="3">Total CFT is Approximately : ${esc(t.cft)}</td>
          <td></td>
          <td class="c">${t.ctns || ''}</td>
          <td class="c">${unitTotals}</td>
          <td class="r">US$</td>
          <td class="r">${esc(t.amount)}</td>
        </tr>
      </tbody>
    </table>
    <div class="fobfoot">FOB COLOMBO PORT, SRI LANKA.</div>
  </div>`
}

function page2(company: CompanyDetails, bank: string, p: P): string {
  const c = p.customer
  const t = totals(p.lines)
  const g = p.page2
  const field = (label: string, value: string, tail = '') => `${label} ${value ? esc(value) : ''}${tail}`
  // the factory name (first line) and the A/C No, bank name and SWIFT lines are bold
  let seenFirst = false
  const bankHtml = bank
    .split(/\r?\n/)
    .map((ln) => {
      const tr = ln.trim()
      let bold = false
      if (tr) {
        if (!seenFirst) {
          bold = true
          seenFirst = true
        } else if (/A\/C\s*No|SWIFT|BANK\s+(PLC|LTD)\b/i.test(tr)) bold = true
      }
      return `<div${bold ? ' class="b"' : ''}>${tr ? text(ln) : '&nbsp;'}</div>`
    })
    .join('')
  const s = g.marks.side
  const inr = g.marks.inner
  const marks =
    g.marks.mode === 'images'
      ? `<div class="markimg">${g.marks.images.map((src) => `<img src="${esc(src)}">`).join('')}</div>`
      : `<table class="marks"><tr>
          <td><b>SHIP-MARK</b><br>${text(g.marks.shipMark)}</td>
          <td><b>Side Mark</b><br>${field('Item No:', s.itemNo)}<br>${field("Q'ty :", s.qty, ' pcs.')}<br>${field('Color/Asst:', s.colourAsst)}<br>${field('N.W. :', s.nw, ' kgs.')}<br>${field('G.W. :', s.gw, ' kgs.')}</td>
          <td><b>Inner Box Marking</b><br>${field('Item No:', inr.itemNo)}<br>${field('Color/Asst:', inr.colourAsst)}<br>${field("Q'ty :", inr.qty, ' pcs')}</td>
        </tr></table>
        ${g.marks.cartonNo.trim() ? `<div class="cno">${text(g.marks.cartonNo)}</div>` : ''}`
  const label6 = g.specialLabelItems.length ? ` (${g.specialLabelItems.map(esc).join(', ')})` : ''
  const finalNo = 8 + g.clauses.length
  return `<div class="page">
    ${header(company, p.invoiceNo, p.date, 2)}
    <div class="p2head">To : ${text(c.name)}${c.country.trim() ? ` / ${text(c.country)}` : ''}</div>
    <ol class="terms">
      <li>Total amount of this Proforma Invoice <b>No :${text(p.invoiceNo)}</b><br>is <b>US$ ${esc(t.amount)} FOB COLOMBO PORT, SRI LANKA.</b></li>
      <li>Total Q-ty to be shipped by <b>${text(g.container)}</b>.<br>from port of ${text(g.fromPort)} to port of <b>${text(g.toPort)}</b>.</li>
      <li>T/T payment in favour of our factory
        <div class="bank">${bankHtml}</div>
        <ul class="sub">
          <li>a. Latest shipment date : <b>${text(g.latestShipment)}</b> from port of ${text(g.fromPort)}.</li>
          <li><b>b. Partial shipments , if any, are allowed.</b></li>
          <li><b>c. Transhipments , if any, are allowed.</b></li>
          <li>d. ${text(g.originCert)}</li>
          <li>e. Fumigation Certificate will be supplied.</li>
          <li>f. Forwarder Bill of Lading acceptable</li>
          <li>g. Phytosanitary Certificate will be supplied.</li>
        </ul>
      </li>
      <li class="ship">Shipping Marks${marks}</li>
      <li class="made">'Made in Sri Lanka.' origin marks on goods - <span class="yn">${yn(g.originOnGoods)}</span>&nbsp;&nbsp;Innerboxes - <span class="yn">${yn(g.originOnInnerboxes)}</span>&nbsp;&nbsp;Cartons - <span class="yn">${yn(g.originOnCartons)}</span>${g.specialMarks.trim() ? `<br>${text(g.specialMarks)}` : ''}</li>
      <li><span class="yn">${yn(g.specialLabels)}</span> - Special customer's labels and or other special labels.${label6}</li>
      <li><span class="yn">${yn(g.forwardingAgent)}</span> - Customer's special forwarding agent to be used:<br>If yes : Name of Forwarding Agent : ${text(g.forwardingAgentName) || 'TO BE ADVISED'}</li>
      ${g.clauses.map((x, i) => `<li value="${8 + i}">${text(x)}</li>`).join('')}
      <li value="${finalNo}">${esc(FINAL_CLAUSE)}</li>
    </ol>
  </div>`
}

export function proformaHtml(company: CompanyDetails, bank: string, pf: PmaProforma): string {
  const p = normalize(pf)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.invoiceNo || 'Proforma Invoice')}</title><style>${CSS}</style></head>
<body>${page1(company, p)}${page2(company, bank, p)}
<script>
(function () {
  function done() { window.__pageCount = document.querySelectorAll('.page').length; window.__paginated = true; }
  var imgs = Array.prototype.slice.call(document.images);
  var waiting = imgs.length;
  if (!waiting) return done();
  imgs.forEach(function (img) { if (img.complete) { if (--waiting === 0) done(); } else { img.onload = img.onerror = function () { if (--waiting === 0) done(); }; } });
})();
</script>
</body></html>`
}
