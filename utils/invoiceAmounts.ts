import { Invoice } from '../types';

export const getInvoiceFaceValue = (invoice: Pick<Invoice, 'subtotal' | 'iva' | 'total'>) => {
  const subtotal = Number(invoice.subtotal || 0);
  const iva = Number(invoice.iva || 0);
  const total = Number(invoice.total || 0);
  const baseAmount = subtotal + iva;

  return baseAmount > total ? baseAmount : total;
};
