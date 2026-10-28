import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { amountInWords, blankLine, DEFAULT_CI, invoiceSums, newInvoice, normalizeInvoice, type CommercialInvoice } from '../src/shared/invoice'
import { foxValues } from '../src/shared/foxMap'
import { packingFromInvoice, newPackingList } from '../src/shared/packing'
import { ShipStore } from '../src/main/store'
import { openNodeSqlite } from './helpers'

const inv = (discount: string, discountType: CommercialInvoice['discountType'] = 'percent'): CommercialInvoice => ({
  ...newInvoice(DEFAULT_CI),
  invoiceNo: 'M/26/001',
  discount,
  discountType,
  lines: [
    { ...blankLine(), qty: '1632', price: '4.12', total: '6723.84' },
    { ...blankLine(), qty: '1500', price: '4.12', total: '6180.00' }
  ]
})

describe('invoice discount', () => {
  it('has no discount when it is left blank', () => {
    const s = invoiceSums(inv(''))
    expect(s).toMatchObject({ subtotal: 12903.84, discount: 0, total: 12903.84, hasDiscount: false, percentText: '' })
    expect(invoiceSums(inv('0'))).toMatchObject({ hasDiscount: false, total: 12903.84 })
  })

  it('takes a percentage off the items total', () => {
    expect(invoiceSums(inv('5'))).toMatchObject({ subtotal: 12903.84, discount: 645.19, total: 12258.65, hasDiscount: true, percentText: '5%' })
    expect(invoiceSums(inv('2.5'))).toMatchObject({ discount: 322.6, percentText: '2.5%' })
  })

  it('takes a fixed amount off', () => {
    expect(invoiceSums(inv('903.84', 'amount'))).toMatchObject({ discount: 903.84, total: 12000, percentText: '' })
  })

  it('never takes off more than the total', () => {
    expect(invoiceSums(inv('20000', 'amount'))).toMatchObject({ discount: 12903.84, total: 0 })
    expect(invoiceSums(inv('150'))).toMatchObject({ discount: 12903.84, total: 0 })
  })

  it('uses the total after the discount for words, FoxPro, the saved list and the packing list', () => {
    const ci = inv('903.84', 'amount')
    expect(amountInWords(invoiceSums(ci).total)).toBe('U.S.Dollars Twelve Thousand Only.')
    expect(foxValues(ci).TOTAL_AMT).toBe(12000)
    expect(packingFromInvoice({ ...ci, id: 'x' }, newPackingList()).amount).toBe('12000.00')
    const store = new ShipStore(join(mkdtempSync(join(tmpdir(), 'disc-')), 'shipments.db'), openNodeSqlite)
    store.save(ci)
    expect(store.list()[0].amount).toBe(12000)
    store.close()
  })

  it('opens an invoice saved before discounts existed with no discount', () => {
    const old = { ...inv('') } as Partial<CommercialInvoice>
    delete old.discount
    delete old.discountType
    delete old.discountLabel
    const ci = normalizeInvoice(old as CommercialInvoice)
    expect(ci).toMatchObject({ discount: '', discountType: 'percent', discountLabel: 'LESS : DISCOUNT' })
    expect(invoiceSums(ci).hasDiscount).toBe(false)
  })
})
