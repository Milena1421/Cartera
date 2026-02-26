
import React from 'react';
import { FinancialStats } from '../types';
import { TrendingUp, TrendingDown, Clock, DollarSign } from 'lucide-react';

interface Props {
  stats: FinancialStats;
}

const DashboardStats: React.FC<Props> = ({ stats }) => {
  const cards = [
    { 
      label: 'Total Facturado', 
      value: stats.totalInvoiced, 
      icon: <DollarSign className="w-5 h-5 text-blue-600" />,
      bg: 'bg-blue-50'
    },
    { 
      label: 'Recaudado', 
      value: stats.totalCollected, 
      icon: <TrendingUp className="w-5 h-5 text-green-600" />,
      bg: 'bg-green-50'
    },
    { 
      label: 'Pendiente', 
      value: stats.totalPending, 
      icon: <Clock className="w-5 h-5 text-amber-600" />,
      bg: 'bg-amber-50'
    },
    { 
      label: 'En Mora', 
      value: stats.totalOverdue, 
      icon: <TrendingDown className="w-5 h-5 text-red-600" />,
      bg: 'bg-red-50'
    }
  ];

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card, i) => (
        <div key={i} className="bg-white p-7 rounded-[1.25rem] border border-slate-100 shadow-sm shadow-slate-200/40 flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className={`${card.bg} p-4 rounded-2xl`}>
            {card.icon}
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">{card.label}</p>
            <p className="text-2xl font-black text-slate-800 tracking-tight">{formatCurrency(card.value)}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DashboardStats;
