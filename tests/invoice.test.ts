import { describe, it, expect } from 'vitest'
import { amountInWords, longDate, invoiceTotals, splitColour, blankLine, numberWords, moneyGrouped } from '../src/shared/invoice'

describe('invoice model', () => {
  it('writes the amount in words like the old invoice', () => {
    expect(amountInWords(32301.12)).toBe('U.S.Dollars Thirty Two Thousand Three Hundred and One and Cents Twelve Only.')
    expect(amountInWords(1000)).toBe('U.S.Dollars One Thousand Only.')
    expect(numberWords(1215)).toBe('One Thousand Two Hundred and Fifteen')
    expect(numberWords(2000019)).toBe('Two Million Nineteen')
  })
  it('formats dates and money', () => {
    expect(longDate('2023-03-23')).toBe('Mar 23rd 2023')
    expect(longDate('2026-10-01')).toBe('Oct 1st 2026')
    expect(longDate('2026-10-12')).toBe('Oct 12th 2026')
    expect(moneyGrouped(32301.12)).toBe('32,301.12')
  })
  it('adds up the totals of the sample invoice', () => {
    const rows: [string, string, string][] = [['136', '1632', '6723.84'], ['125', '1500', '6180.00'], ['28', '1344', '2526.72'], ['37', '1776', '3338.88'],
      ['45', '180', '2556.00'], ['53', '1272', '4159.44'], ['58', '1392', '4551.84'], ['14', '1008', '856.80'], ['23', '1656', '1407.60']]
    const t = invoiceTotals(rows.map(([ctns, qty, total]) => ({ ...blankLine(), ctns, qty, total })))
    expect(t).toEqual({ ctns: 519, byUnit: [{ unit: 'PCS', qty: 11760 }], amount: 32301.12 })
  })
  it('splits long colours at the first dash', () => {
    expect(splitColour('PEACH-PN/40+B/251+B/252')).toEqual({ code: 'PEACH', detail: 'PN/40+B/251+B/252' })
    expect(splitColour('WHITE-B/251')).toEqual({ code: 'WHITE-B/251', detail: '' })
  })
})
