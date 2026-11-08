// Bill totals, same rules as _biz_totals in the database (which has the final say).
// Line totals include GST; a discount lowers every line by the same share; the total is rounded to the rupee.
export type Line = { item_id?: string | null; name: string; price: number; qty: number; gst_rate: number; hsn?: string | null; note?: string | null };
export type Totals = { items: number; discount: number; taxable: number; cgst: number; sgst: number; round_off: number; total: number;
  by_rate: { rate: number; taxable: number; tax: number }[] };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const lineGross = (l: Line, inclusive: boolean) => l.price * l.qty * (inclusive ? 1 : 1 + l.gst_rate / 100);

export function totals(lines: Line[], inclusive: boolean, discount = 0): Totals {
  const gross = lines.reduce((a, l) => a + lineGross(l, inclusive), 0);
  const d = Math.min(Math.max(discount, 0), gross);
  const factor = gross > 0 ? (gross - d) / gross : 0;
  const rates = [...new Set(lines.map((l) => l.gst_rate))].sort((a, b) => a - b);
  let taxable = 0, tax = 0;
  const by_rate = rates.map((rate) => {
    const amount = lines.filter((l) => l.gst_rate === rate).reduce((a, l) => a + lineGross(l, inclusive), 0) * factor;
    const t = r2(amount / (1 + rate / 100)), x = r2(r2(amount) - t);
    taxable += t; tax += x;
    return { rate, taxable: t, tax: x };
  });
  taxable = r2(taxable); tax = r2(tax);
  const cgst = r2(tax / 2), total = Math.round(taxable + tax);
  return { items: r2(gross), discount: r2(d), taxable, cgst, sgst: r2(tax - cgst), round_off: r2(total - (taxable + tax)), total, by_rate };
}

export const rupees = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const paise = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
