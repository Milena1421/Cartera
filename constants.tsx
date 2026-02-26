
import { Invoice, BankTransaction } from './types';

// Función auxiliar para parsear valores numéricos de strings con formato COP (ej: "1.234.567,89")
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
    invoiceNumber: 'FING 1076',
    description: 'Robotics as a Service (RaaS) - Mantenimiento preventivo mensual de flota de robots quirúrgicos.',
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
    observations: 'Pendiente confirmación de recibido por parte de almacén.',
    moraDays: 4
  },
  {
    id: 'FING1075',
    clientName: 'HOSPITAL PABLO TOBON URIBE',
    invoiceNumber: 'FING 1075',
    description: 'Soporte técnico especializado y consultoría en optimización de bases de datos clínicas.',
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
    observations: 'Se solicita envío de RUT actualizado para proceso de pago.',
    moraDays: 8
  },
  {
    id: 'FING 776',
    clientName: 'CAMARA DE COMERCIO DEL MAGDALENA MEDIO',
    invoiceNumber: 'FING 776',
    description: 'Cloud Computing Software SAAS- Análisis de Datos Estructura Empresarial Cámaras de Comercio de Colombia.',
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
    observations: 'Pago recibido vía transferencia bancaria.',
    paymentDate: '2025-01-07',
    paidAmount: parseCOP('653.698'),
    paidWithWithholdings: parseCOP('653.698'),
    moraDays: 0
  },
  {
    id: 'FING 345',
    clientName: 'ARQUITECTURA Y CONSTRUCCIONES S.A.S.',
    invoiceNumber: 'FING 345',
    description: 'Desarrollo de Software - Total Desarrollo Timeline Arconsa. ACTA DE OBRA NO. 7 CONTRATO NO. 4360041',
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
    observations: 'Factura en revisión por parte del interventor.',
    moraDays: 45
  }
];

export const MOCK_BANK_TRANSACTIONS: BankTransaction[] = [
  { id: 'tx-1', date: '2025-01-07', description: 'ABONO CAMARA COMERCIO MAGDALENA', amount: 653698, reference: 'FING 776', isMatched: true },
  { id: 'tx-2', date: '2025-05-20', description: 'PAGO CESDE SAS CONTRATO 328', amount: 139164000, reference: 'FING 843', isMatched: true },
  { id: 'tx-3', date: '2025-02-25', description: 'RECAUDO PACIENTE PARTICULAR STA LUCIA', amount: 1841520, reference: 'FING 1076', isMatched: false },
];
