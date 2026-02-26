
import React, { useState, useEffect } from 'react';
import { X, Save, FileText, User, Calendar, DollarSign, AlignLeft, PieChart, Landmark } from 'lucide-react';
import { Invoice, PaymentStatus } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (invoice: Invoice) => void;
  initialData?: Invoice | null;
}

const ManualInvoiceModal: React.FC<Props> = ({ isOpen, onClose, onSave, initialData }) => {
  const [formData, setFormData] = useState({
    clientName: '',
    invoiceNumber: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    total: '',
    status: 'Pendiente por pagar' as PaymentStatus,
    paymentDate: '',
    creditDate: '',
    creditAmount: '',
    paidAmount: '',
    reteFuente: '',
    reteIva: '',
    reteIca: '',
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        clientName: initialData.clientName,
        invoiceNumber: initialData.invoiceNumber,
        description: initialData.description,
        date: initialData.date,
        dueDate: initialData.dueDate || initialData.date,
        total: initialData.total.toString(),
        status: initialData.status,
        paymentDate: initialData.paymentDate || '',
        creditDate: initialData.creditDate || '',
        creditAmount: initialData.creditAmount?.toString() || '',
        paidAmount: initialData.paidAmount?.toString() || '',
        reteFuente: initialData.reteFuente?.toString() || '',
        reteIva: initialData.reteIva?.toString() || '',
        reteIca: initialData.reteIca?.toString() || '',
      });
    } else {
      const today = new Date().toISOString().split('T')[0];
      setFormData({
        clientName: '',
        invoiceNumber: '',
        description: '',
        date: today,
        dueDate: today,
        total: '',
        status: 'Pendiente por pagar',
        paymentDate: '',
        creditDate: '',
        creditAmount: '',
        paidAmount: '',
        reteFuente: '',
        reteIva: '',
        reteIca: '',
      });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const normalizeInv = (val: string): string => {
    const clean = val.toUpperCase().trim().replace(/[-.]/g, '');
    const match = clean.match(/^([A-Z]+)\s*([0-9]+)$/) || clean.match(/^([A-Z]+)([0-9]+)$/);
    if (match) return `${match[1]} ${match[2]}`;
    return clean;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const totalNum = parseFloat(formData.total) || 0;
    const paidNum = parseFloat(formData.paidAmount) || 0;
    const creditNum = parseFloat(formData.creditAmount) || 0;
    const rf = parseFloat(formData.reteFuente) || 0;
    const ri = parseFloat(formData.reteIva) || 0;
    const rc = parseFloat(formData.reteIca) || 0;
    
    // Deuda = Total - (Pagado + Abono + Retenciones)
    const totalDeductions = paidNum + creditNum + rf + ri + rc;
    const debt = formData.status === 'Pagada' ? 0 : Math.max(0, totalNum - totalDeductions);

    const invoiceData: Invoice = {
      ...(initialData || {}),
      id: initialData?.id || `manual-${Date.now()}`,
      clientName: formData.clientName.toUpperCase(),
      invoiceNumber: normalizeInv(formData.invoiceNumber),
      description: formData.description,
      date: formData.date,
      dueDate: formData.dueDate,
      subtotal: totalNum / 1.19,
      iva: totalNum - (totalNum / 1.19),
      total: totalNum,
      discounts: initialData?.discounts || 0,
      reteFuente: rf,
      reteIva: ri,
      reteIca: rc,
      status: formData.status,
      paymentDate: formData.paymentDate || undefined,
      creditDate: formData.creditDate || undefined,
      creditAmount: creditNum,
      paidAmount: paidNum,
      debtValue: debt,
      observations: initialData?.observations || 'Actualización manual',
      moraDays: 0,
      isSynced: initialData?.isSynced || false
    };

    onSave(invoiceData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100 scale-in-center my-8">
        <div className="bg-[#0f172a] px-10 py-8 flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-600/20">
              <FileText size={24} />
            </div>
            <div>
              <h2 className="font-black text-xl tracking-tight uppercase">
                {initialData ? 'Editar Factura' : 'Nueva Factura'}
              </h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.3em]">Gestión de Recaudo e Información</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-10 space-y-8 custom-scrollbar max-h-[75vh] overflow-y-auto">
          <div className="space-y-5">
            <h3 className="text-[11px] font-black text-blue-600 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Datos Básicos</h3>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <User size={12} className="text-blue-500" /> Cliente
              </label>
              <input required type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none uppercase" value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={12} className="text-blue-500" /> No. Factura
                </label>
                <input required type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none uppercase" value={formData.invoiceNumber} onChange={e => setFormData({...formData, invoiceNumber: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={12} className="text-blue-500" /> Valor Total
                </label>
                <input required type="number" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.total} onChange={e => setFormData({...formData, total: e.target.value})} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Calendar size={12} className="text-blue-500" /> Fecha Emisión
                </label>
                <input required type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Calendar size={12} className="text-orange-500" /> Fecha Vencimiento
                </label>
                <input required type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none border-orange-100" value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} />
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-[11px] font-black text-emerald-600 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Control de Recaudo</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <PieChart size={12} className="text-emerald-500" /> Estado Pago
                </label>
                <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none cursor-pointer" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as PaymentStatus})}>
                  <option value="Pendiente por pagar">Pendiente</option>
                  <option value="Pagada">Pagada</option>
                  <option value="Nota crédito">Nota Crédito</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={12} className="text-emerald-500" /> Valor Recaudado (Total)
                </label>
                <input type="number" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.paidAmount} onChange={e => setFormData({...formData, paidAmount: e.target.value})} />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-blue-50/50 rounded-2xl border border-blue-100">
               <div className="space-y-2">
                <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                  <Landmark size={12} /> Valor Abono
                </label>
                <input type="number" placeholder="Monto del abono" className="w-full bg-white border border-blue-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none focus:border-blue-500" value={formData.creditAmount} onChange={e => setFormData({...formData, creditAmount: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                  <Calendar size={12} /> Fecha Abono
                </label>
                <input type="date" className="w-full bg-white border border-blue-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none focus:border-blue-500" value={formData.creditDate} onChange={e => setFormData({...formData, creditDate: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Calendar size={12} className="text-emerald-500" /> Fecha Recaudo Final (Pago)
              </label>
              <input type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-bold outline-none" value={formData.paymentDate} onChange={e => setFormData({...formData, paymentDate: e.target.value})} />
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-[11px] font-black text-amber-600 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Retenciones Manuales</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
               <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">R. Fuente</label>
                <input type="number" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" value={formData.reteFuente} onChange={e => setFormData({...formData, reteFuente: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">R. IVA</label>
                <input type="number" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" value={formData.reteIva} onChange={e => setFormData({...formData, reteIva: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">R. ICA</label>
                <input type="number" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" value={formData.reteIca} onChange={e => setFormData({...formData, reteIca: e.target.value})} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <AlignLeft size={12} className="text-blue-500" /> Descripción / Observaciones
            </label>
            <textarea rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 text-sm font-medium outline-none resize-none" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>

          <div className="pt-6 flex gap-4">
            <button type="button" onClick={onClose} className="flex-1 px-8 py-5 rounded-2xl border-2 border-slate-100 text-slate-400 font-black text-[11px] uppercase tracking-[0.2em] hover:bg-slate-50 transition-all">Cancelar</button>
            <button type="submit" className="flex-1 px-8 py-5 rounded-2xl bg-[#0f172a] text-white font-black text-[11px] uppercase tracking-[0.2em] shadow-2xl hover:bg-blue-600 transition-all flex items-center justify-center gap-3">
              <Save size={18} /> {initialData ? 'Actualizar Factura' : 'Guardar Factura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ManualInvoiceModal;
