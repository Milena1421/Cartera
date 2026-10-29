import { Invoice } from '../types';

const parseLocalDate = (value?: string) => {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const local = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  const year = iso?.[1] || local?.[3];
  const month = iso?.[2] || local?.[2];
  const day = iso?.[3] || local?.[1];
  if (!year || !month || !day) return null;
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const isPaid = (status?: string) =>
  String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '') === 'pagada';

export const getPeriodEndDate = (period?: string) => {
  const match = String(period || '').match(/^(\d{4})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]), 0) : null;
};

/** Facturación acumulada menos recaudos acumulados hasta la fecha de corte. */
export const calculateAccumulatedPortfolio = (invoices: Invoice[], cutoff?: Date | null) => {
  const cutoffTime = cutoff ? new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate()).getTime() : null;
  let invoiced = 0;
  let collected = 0;

  invoices.forEach((invoice) => {
    const invoiceDate = parseLocalDate(invoice.date);
    if (cutoffTime !== null && (!invoiceDate || invoiceDate.getTime() > cutoffTime)) return;

    invoiced += Number(invoice.total || 0);
    const payment = isPaid(invoice.status)
      ? Number(invoice.paidAmount || invoice.total || 0)
      : Number(invoice.paidAmount || 0);
    const credit = Number(invoice.creditAmount || 0);
    const paymentDate = parseLocalDate(invoice.paymentDate) || parseLocalDate(invoice.creditDate);

    // Sin corte se muestran todos los recaudos. Con corte, solo los que ya
    // ocurrieron en ese momento; fechas ausentes no se anticipan.
    if (cutoffTime === null || (paymentDate && paymentDate.getTime() <= cutoffTime)) {
      collected += payment + credit;
    }
  });

  return Math.max(0, invoiced - collected);
};
