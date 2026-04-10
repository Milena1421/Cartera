import { Invoice, BankTransaction } from './types';

const parseCOP = (val: string | number | undefined): number => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const clean = val.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export const MOCK_INVOICES: Invoice[] = [
  {
    id: 'FING1076',
    clientName: 'ORGANIZACION SANTA LUCIA S.A',
    invoiceNumber: 'FING1076',
    description: 'Robotics as a Service (RaaS) - Mantenimiento preventivo mensual de flota de robots quirurgicos.',
    date: '2025-02-16',
    dueDate: '2025-02-16',
    subtotal: parseCOP('1.547.496'),
    iva: parseCOP('294.024'),
    total: parseCOP('1.841.520'),
    discounts: 0,
    reteFuente: 0,
    reteIva: 0,
    reteIca: 0,
    status: 'Pendiente por pagar',
    debtValue: parseCOP('1.841.520'),
    observations: '',
    moraDays: 4
  },
  {
    id: 'FING1075',
    clientName: 'HOSPITAL PABLO TOBON URIBE',
    invoiceNumber: 'FING1075',
    description: 'Soporte tecnico especializado y consultoria en optimizacion de bases de datos clinicas.',
    date: '2025-02-12',
    dueDate: '2025-02-12',
    subtotal: parseCOP('2.100.840'),
    iva: parseCOP('399.160'),
    total: parseCOP('2.500.000'),
    discounts: 0,
    reteFuente: 0,
    reteIva: 0,
    reteIca: 0,
    status: 'Pendiente por pagar',
    debtValue: parseCOP('2.500.000'),
    observations: '',
    moraDays: 8
  },
  {
    id: 'FING776',
    clientName: 'CAMARA DE COMERCIO DEL MAGDALENA MEDIO',
    invoiceNumber: 'FING776',
    description: 'Cloud Computing Software SAAS - Analisis de datos estructura empresarial camaras de comercio de Colombia.',
    date: '2025-01-03',
    dueDate: '2025-01-03',
    subtotal: parseCOP('653.698'),
    iva: 0,
    total: parseCOP('653.698'),
    discounts: 0,
    reteFuente: 0,
    reteIva: 0,
    reteIca: 0,
    status: 'Pagada',
    debtValue: 0,
    observations: '',
    paymentDate: '2025-01-07',
    paidAmount: parseCOP('653.698'),
    paidWithWithholdings: parseCOP('653.698'),
    moraDays: 0
  },
  {
    id: 'FING345',
    clientName: 'ARQUITECTURA Y CONSTRUCCIONES S.A.S.',
    invoiceNumber: 'FING345',
    description: 'Desarrollo de software - total desarrollo timeline Arconsa. Acta de obra no. 7 contrato no. 4360041.',
    date: '2024-12-16',
    dueDate: '2024-12-16',
    subtotal: parseCOP('17.073.396'),
    iva: parseCOP('3.243.945'),
    total: parseCOP('20.317.341'),
    discounts: 0,
    reteFuente: 0,
    reteIva: 0,
    reteIca: 0,
    status: 'Pendiente por pagar',
    debtValue: parseCOP('20.317.341'),
    observations: '',
    moraDays: 45
  }
];

export const MOCK_BANK_TRANSACTIONS: BankTransaction[] = [
  { id: 'tx-1', date: '2025-01-07', description: 'ABONO CAMARA COMERCIO MAGDALENA', amount: 653698, reference: 'FING776', isMatched: true },
  { id: 'tx-2', date: '2025-05-20', description: 'PAGO CESDE SAS CONTRATO 328', amount: 139164000, reference: 'FING 843', isMatched: true },
  { id: 'tx-3', date: '2025-02-25', description: 'RECAUDO PACIENTE PARTICULAR STA LUCIA', amount: 1841520, reference: 'FING1076', isMatched: false },
];
