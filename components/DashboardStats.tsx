
import React from 'react';
import { FinancialStats } from '../types';
import { TrendingUp, TrendingDown, Clock, DollarSign, FileText, Percent, ReceiptText } from 'lucide-react';
import { formatCurrency, formatNumber } from '../utils/formatters';

interface Props {
  stats: FinancialStats;
}

const DashboardStats: React.FC<Props> = ({ stats }) => {
  const cards = [
    {
      label: 'Total Facturas',
      value: stats.totalInvoices,
      icon: <FileText className="w-5 h-5 text-sky-600" />,
      bg: 'bg-sky-50',
      format: 'number'
    },
    { 
      label: 'Total Facturado', 
      value: stats.totalInvoiced, 
      icon: <DollarSign className="w-5 h-5 text-blue-600" />,
      bg: 'bg-blue-50',
      format: 'currency'
    },
    {
      label: 'IVA Facturado',
      value: stats.totalIva,
      icon: <ReceiptText className="w-5 h-5 text-indigo-600" />,
      bg: 'bg-indigo-50',
      format: 'currency'
    },
    {
      label: 'ReteIVA',
      value: stats.totalReteIva,
      icon: <Percent className="w-5 h-5 text-violet-600" />,
      bg: 'bg-violet-50',
      format: 'currency'
    },
    { 
      label: 'Recaudado', 
      value: stats.totalCollected, 
      icon: <TrendingUp className="w-5 h-5 text-green-600" />,
      bg: 'bg-green-50',
      format: 'currency'
    },
    { 
      label: 'Pendiente', 
      value: stats.totalPending, 
      icon: <Clock className="w-5 h-5 text-amber-600" />,
      bg: 'bg-amber-50',
      format: 'currency'
    },
    { 
      label: 'En Mora', 
      value: stats.totalOverdue, 
      icon: <TrendingDown className="w-5 h-5 text-red-600" />,
      bg: 'bg-red-50',
      format: 'currency'
    }
  ];

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-6 mb-8">
      {cards.map((card, i) => {
        const formattedValue = card.format === 'number' ? formatNumber(card.value) : formatCurrency(card.value);
        const valueSize = card.format === 'number' ? 'text-2xl' : 'text-[clamp(1.05rem,1.3vw,1.25rem)]';

        return (
          <div key={i} className="min-w-0 overflow-hidden bg-white px-5 py-6 rounded-[1.25rem] border border-slate-100 shadow-sm shadow-slate-200/40 flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className={`${card.bg} shrink-0 p-3.5 rounded-2xl`}>
              {card.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">{card.label}</p>
              <p className={`${valueSize} font-black text-slate-800 tracking-tight leading-tight whitespace-nowrap`}>
                {formattedValue}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DashboardStats;
