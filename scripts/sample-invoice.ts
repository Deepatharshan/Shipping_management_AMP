/** Writes the sample invoice (M/23/002, the printed example) as HTML, for checking the layout. */
import { writeFileSync } from 'node:fs'
import { invoiceHtml } from '../src/main/pdf/invoiceTemplate'
import { newInvoice, blankLine, DEFAULT_CI } from '../src/shared/invoice'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const ci = newInvoice(DEFAULT_CI, '2023-03-23')
Object.assign(ci, {
  invoiceNo: 'M/23/002', consignee: 'RNA RESOURCES GROUP LIMITED\nOPERATING AS "LANDMARK"\nJAFZA LICENSE NUMBER 103288\nP.O. BOX 17155, JEBEL ALI FREE ZONE\nDUBAI, UAE',
  vessel: 'SM MAHI', voyage: '054W', etd: '2023-03-26', eta: '2023-04-02', containerNo: 'MRKU0380028', sealNo: 'ML-LK0395388', asnNo: 'CI1HC2255799-NON-PTS',
  piNo: 'SM 46262 JW', piLabel: 'SM 46262 JW', poNo: '1568821', pod: 'JEBEL ALI',
  shippingMarks: 'HCJW/46262 and Distribution as Per Purchase Order', orderReference: 'JEBEL ALI : HCJW/46262 and Distribution as per Purchase Order'
})
const L = (yourItemNo: string, ourItem: string, description: string, packing: string, colour: string, barcode: string, ctns: string, qty: string, price: string, total: string) =>
  ({ ...blankLine(), yourItemNo, ourItem, description, packing, colour, barcode, ctns, qty, price, total })
ci.lines = [
  L('161930493', 'Y39AZPE44/E035 S', 'MIX ROSE & POM POM IN WOVEN VASE 18X18X20CM H', '2 pc/box,12 pcs/ctn.', 'PEACH-PN/40+B/251+B/252', '6292467281823', '136', '1632', '4.12', '6723.84'),
  L('161930496', 'Y39AZWT05/E035 S', 'MIX ROSE & POM POM IN WOVEN VASE 18X18X20CM H', '2 pc/box,12 pcs/ctn.', 'WHITE-B/251', '6292467281854', '125', '1500', '4.12', '6180.00'),
  L('161930498', 'Y42AZYE64 E035', 'DAISY ROUND IN GLASS VASE (J450G/1) 10X10X35CM H', '6 pc/box,48 pcs/ctn.', 'YELLOW-G/289', '6292467281656', '28', '1344', '1.88', '2526.72'),
  L('161930499', 'Y44AZWH48 E035', 'ORCHID ROUND IN GLASS VASE (J450G/1) 10X10X35CM H', '6 pc/box,48 pcs/ctn.', 'WHITE', '6292467281663', '37', '1776', '1.88', '3338.88'),
  L('164448687', 'Y64AZPK76 E725', 'MIX ROSES IN PUMPKIN CENTRE PC ARR (PK03) 33X33X33CM H', '4 pcs/ctn.', 'PINK GREEN', '6292479093810', '45', '180', '14.2', '2556.00'),
  L('164448688', 'Z14AZCH03/SP E03', 'MIXED ROSES IN GLASS VASE W/OUT BOW (TLT/228) 16X16X18.5CM H', '6 pc/box,24 pcs/ctn.', 'WHITE+CHAMPAGNE', '6292479093773', '53', '1272', '3.27', '4159.44'),
  L('164448689', 'Z14AZFU01/SP E03', 'MIXED ROSES IN GLASS VASE W/OUT BOW (TLT/228) 16X16X18.5CM H', '6 pc/box,24 pcs/ctn.', 'PINK', '6292479093780', '58', '1392', '3.27', '4551.84'),
  L('164448690', 'Z62AZPN48/SP E03', 'APPLE BLOSSOM IN GLASS VASE W/OUT BOW (TLT/207) 9X7X15.5CM H', '12 pc/box,72 pcs/ctn.', 'PINK+GREEN', '6292479093759', '14', '1008', '0.85', '856.80'),
  L('164448691', 'Z62AZWH02/SP E03', 'APPLE BLOSSOM IN GLASS VASE W/OUT BOW (TLT/207) 9X7X15.5CM H', '12 pc/box,72 pcs/ctn.', 'WHITE+GREEN', '6292479093766', '23', '1656', '0.85', '1407.60')
]
writeFileSync(process.argv[2] ?? 'sample-invoice.html', invoiceHtml(DEFAULT_SETTINGS.company, ci))
