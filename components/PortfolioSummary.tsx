import React from 'react';
import { CheckSquare, FileText, Receipt, Square, UserRound } from 'lucide-react';
import { Invoice } from '../types';
import { formatCurrency } from '../utils/formatters';

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
  selectedInvoiceIds: string[];
  onToggleInvoice: (invoiceId: string) => void;
  onToggleClientInvoices: (invoiceIds: string[]) => void;
  showOnlySelected: boolean;
  onShowOnlySelectedChange: (value: boolean) => void;
}

const formatDate = (value?: string) => {
  if (!value) return '-';
  const trimmed = String(value).trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }

  const localMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (localMatch) {
    const [, day, month, year] = localMatch;
    return `${day}/${month}/${year}`;
  }

  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return trimmed;

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
};

const parseInvoiceDate = (value?: string) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const localMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (localMatch) {
    const [, day, month, year] = localMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const getInvoiceMoraDaysFromDueDate = (invoice: Invoice) => {
  const dueDate = parseInvoiceDate(invoice.dueDate);
  if (!dueDate) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
};

const PortfolioSummary: React.FC<Props> = ({
  groups,
  selectedInvoiceIds,
  onToggleInvoice,
  onToggleClientInvoices,
  showOnlySelected,
  onShowOnlySelectedChange,
}) => {
  const selectedInvoiceIdSet = new Set(selectedInvoiceIds);
  const selectedInvoices = groups.flatMap((group) => group.invoices).filter((invoice) => selectedInvoiceIdSet.has(invoice.id));
  const totalInvoices = selectedInvoices.length;
  const totalSubtotal = selectedInvoices.reduce((acc, invoice) => acc + Number(invoice.subtotal || 0), 0);
  const totalIva = selectedInvoices.reduce((acc, invoice) => acc + Number(invoice.iva || 0), 0);
  // El saldo es el valor exigible hoy: ya descuenta los abonos conciliados.
  const totalAmount = selectedInvoices.reduce((acc, invoice) => acc + Number(invoice.debtValue || 0), 0);
  const totalDebt = selectedInvoices.reduce((acc, invoice) => acc + Number(invoice.debtValue || 0), 0);
  const maxMoraDays = selectedInvoices.reduce(
    (maxDays, invoice) => Math.max(maxDays, getInvoiceMoraDaysFromDueDate(invoice)),
    0
  );

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-[1rem] shadow-sm overflow-hidden border border-slate-100 p-20 text-center text-slate-500 italic font-medium">
        No hay facturas pendientes para resumir con los filtros actuales.
      </div>
    );
  }

  const visibleGroups = showOnlySelected
    ? groups
      .map((group) => ({ ...group, invoices: group.invoices.filter((invoice) => selectedInvoiceIdSet.has(invoice.id)) }))
      .filter((group) => group.invoices.length > 0)
    : groups;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-[1.4rem] border border-blue-100 bg-blue-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-slate-900">Reporte para cliente</p>
          <p className="mt-1 text-xs font-medium text-slate-600">
            {totalInvoices === 0
              ? 'Seleccione las facturas que desea incluir.'
              : `${totalInvoices} factura${totalInvoices === 1 ? '' : 's'} seleccionada${totalInvoices === 1 ? '' : 's'} para reportar.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onShowOnlySelectedChange(!showOnlySelected)}
          disabled={totalInvoices === 0 && !showOnlySelected}
          className="rounded-xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {showOnlySelected ? 'Modificar selección' : 'Ver solo seleccionadas'}
        </button>
      </div>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Clientes</p>
          <p className="mt-3 text-[30px] leading-none font-black text-slate-900">{groups.length}</p>
        </article>
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Facturas Seleccionadas</p>
          <p className="mt-3 text-[30px] leading-none font-black text-slate-900">{totalInvoices}</p>
        </article>
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Subtotal a Reportar</p>
          <p className="mt-3 text-[30px] leading-none font-black text-slate-900">{formatCurrency(totalSubtotal)}</p>
        </article>
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Saldo a Reportar</p>
          <p className="mt-3 text-[30px] leading-none font-black text-red-600">{formatCurrency(totalAmount)}</p>
        </article>
        <article className="rounded-[1.4rem] border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Mayor Mora</p>
          <p className="mt-3 text-[30px] leading-none font-black text-amber-600">{maxMoraDays} d</p>
        </article>
      </section>

      {visibleGroups.map((group) => {
        const groupInvoiceIds = group.invoices.map((invoice) => invoice.id);
        const selectedInGroup = groupInvoiceIds.filter((id) => selectedInvoiceIdSet.has(id)).length;
        const selectedGroupInvoices = group.invoices.filter((invoice) => selectedInvoiceIdSet.has(invoice.id));
        const groupMaxMoraDays = Math.max(...selectedGroupInvoices.map(getInvoiceMoraDaysFromDueDate), 0);
        const selectedGroupSubtotal = selectedGroupInvoices.reduce((acc, invoice) => acc + Number(invoice.subtotal || 0), 0);
        const selectedGroupIva = selectedGroupInvoices.reduce((acc, invoice) => acc + Number(invoice.iva || 0), 0);
        const selectedGroupAmount = selectedGroupInvoices.reduce((acc, invoice) => acc + Number(invoice.debtValue || 0), 0);

        return (
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
                  <button
                    type="button"
                    onClick={() => onToggleClientInvoices(groupInvoiceIds)}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    {selectedInGroup === groupInvoiceIds.length ? <CheckSquare size={15} className="text-blue-600" /> : <Square size={15} />}
                    {selectedInGroup === groupInvoiceIds.length ? 'Quitar todas' : 'Seleccionar todas'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Facturas</p>
                  <p className="mt-2 text-xl font-black text-slate-900">{selectedInGroup} / {group.invoices.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Mayor Mora</p>
                  <p className="mt-2 text-xl font-black text-amber-600">{groupMaxMoraDays} d</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Saldo Pendiente</p>
                  <p className="mt-2 text-xl font-black text-red-600">{formatCurrency(selectedGroupAmount)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-white">
                <tr className="text-left">
                  <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Reportar</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Factura</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Descripción</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Fecha Vencimiento</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Dias Mora</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Subtotal</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">IVA</th>
                  <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Saldo Pendiente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {group.invoices.map((invoice) => {
                  const invoiceMoraDays = getInvoiceMoraDaysFromDueDate(invoice);
                  const isSelected = selectedInvoiceIdSet.has(invoice.id);

                  return (
                  <tr key={invoice.id} className="align-top">
                    <td className="px-6 py-5 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleInvoice(invoice.id)}
                        aria-label={`${isSelected ? 'Quitar' : 'Incluir'} factura ${invoice.invoiceNumber} del reporte`}
                        title={isSelected ? 'Quitar del reporte' : 'Incluir en el reporte'}
                        className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600"
                      >
                        {isSelected ? <CheckSquare size={20} className="text-blue-600" /> : <Square size={20} />}
                      </button>
                    </td>
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
                    <td className="px-6 py-5 text-sm font-bold text-slate-700">{formatDate(invoice.dueDate)}</td>
                    <td className={`px-6 py-5 text-right text-sm font-black ${invoiceMoraDays > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                      {invoiceMoraDays} d
                    </td>
                    <td className="px-6 py-5 text-right text-sm font-bold text-slate-700">{formatCurrency(invoice.subtotal)}</td>
                    <td className="px-6 py-5 text-right text-sm font-bold text-slate-700">{formatCurrency(invoice.iva)}</td>
                    <td className="px-6 py-5 text-right text-sm font-black text-slate-900">{formatCurrency(invoice.debtValue)}</td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr>
                  <td className="px-6 py-4 text-sm font-black text-slate-500 uppercase" colSpan={5}>
                    Seleccionadas {selectedInGroup} de {group.invoices.length}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-black text-slate-700">{formatCurrency(selectedGroupSubtotal)}</td>
                  <td className="px-6 py-4 text-right text-sm font-black text-slate-700">{formatCurrency(selectedGroupIva)}</td>
                  <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(selectedGroupAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        );
      })}

      <section className="rounded-[1.6rem] border border-slate-200 bg-slate-900 px-6 py-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Total General</p>
            <p className="mt-2 text-2xl font-black">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm font-bold text-slate-200">
            <span>Facturas a reportar: {totalInvoices}</span>
            <span>Mayor mora: {maxMoraDays} d</span>
            <span>Subtotal: {formatCurrency(totalSubtotal)}</span>
            <span>IVA: {formatCurrency(totalIva)}</span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PortfolioSummary;
