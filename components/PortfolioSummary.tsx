import React from 'react';
import { FileText, Receipt, UserRound } from 'lucide-react';
import { Invoice } from '../types';

type ClientSummary = {
  clientName: string;
  invoices: Invoice[];
  totalSubtotal: number;
  totalIva: number;
  totalAmount: number;
  totalDebt: number;
};

interface Props {
  groups: ClientSummary[];
}

const formatCurrency = (value?: number) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const PortfolioSummary: React.FC<Props> = ({ groups }) => {
  const totalInvoices = groups.reduce((acc, group) => acc + group.invoices.length, 0);
  const totalSubtotal = groups.reduce((acc, group) => acc + group.totalSubtotal, 0);
  const totalIva = groups.reduce((acc, group) => acc + group.totalIva, 0);
  const totalAmount = groups.reduce((acc, group) => acc + group.totalAmount, 0);
  const totalDebt = groups.reduce((acc, group) => acc + group.totalDebt, 0);

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-[1rem] shadow-sm overflow-hidden border border-slate-100 p-20 text-center text-slate-500 italic font-medium">
        No hay facturas pendientes para resumir con los filtros actuales.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Clientes</p>
          <p className="mt-3 text-[30px] leading-none font-black text-slate-900">{groups.length}</p>
        </article>
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Facturas Pendientes</p>
          <p className="mt-3 text-[30px] leading-none font-black text-slate-900">{totalInvoices}</p>
        </article>
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Subtotal Pendiente</p>
          <p className="mt-3 text-[30px] leading-none font-black text-slate-900">{formatCurrency(totalSubtotal)}</p>
        </article>
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Valor Factura</p>
          <p className="mt-3 text-[30px] leading-none font-black text-red-600">{formatCurrency(totalDebt || totalAmount)}</p>
        </article>
      </section>

      {groups.map((group) => (
        <section key={group.clientName} className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-white p-3 text-slate-500 border border-slate-200">
                  <UserRound size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Cliente</p>
                  <h3 className="mt-2 text-lg font-black uppercase leading-snug text-slate-900">{group.clientName}</h3>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Facturas</p>
                  <p className="mt-2 text-xl font-black text-slate-900">{group.invoices.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Total Deuda</p>
                  <p className="mt-2 text-xl font-black text-red-600">{formatCurrency(group.totalDebt || group.totalAmount)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-white">
                <tr className="text-left">
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Factura</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Descripción</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Fecha Factura</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Subtotal</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">IVA</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Valor Factura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {group.invoices.map((invoice) => (
                  <tr key={invoice.id} className="align-top">
                    <td className="px-6 py-5">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-slate-50 p-2 text-slate-500 border border-slate-200">
                          <Receipt size={16} />
                        </div>
                        <div>
                          <p className="font-black text-slate-900 uppercase">{invoice.invoiceNumber || '-'}</p>
                          <p className="mt-1 text-xs font-bold text-slate-500">{invoice.documentType || 'DOC'} {invoice.documentNumber || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-slate-50 p-2 text-slate-500 border border-slate-200">
                          <FileText size={16} />
                        </div>
                        <p className="max-w-md whitespace-pre-wrap text-sm leading-6 text-slate-700">{invoice.description || '-'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-sm font-bold text-slate-700">{formatDate(invoice.date)}</td>
                    <td className="px-6 py-5 text-right text-sm font-bold text-slate-700">{formatCurrency(invoice.subtotal)}</td>
                    <td className="px-6 py-5 text-right text-sm font-bold text-slate-700">{formatCurrency(invoice.iva)}</td>
                    <td className="px-6 py-5 text-right text-sm font-black text-slate-900">{formatCurrency(invoice.debtValue || invoice.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr>
                  <td className="px-6 py-4 text-sm font-black text-slate-500 uppercase" colSpan={3}>
                    Recuento {group.invoices.length}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-black text-slate-700">{formatCurrency(group.totalSubtotal)}</td>
                  <td className="px-6 py-4 text-right text-sm font-black text-slate-700">{formatCurrency(group.totalIva)}</td>
                  <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(group.totalDebt || group.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}

      <section className="rounded-[1.6rem] border border-slate-200 bg-slate-900 px-6 py-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Total General</p>
            <p className="mt-2 text-2xl font-black">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm font-bold text-slate-200">
            <span>Facturas: {totalInvoices}</span>
            <span>Subtotal: {formatCurrency(totalSubtotal)}</span>
            <span>IVA: {formatCurrency(totalIva)}</span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PortfolioSummary;
