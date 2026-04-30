export const formatCurrency = (value?: number) => {
  const amount = Number(value || 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const formattedAmount = new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);

  return `$ ${formattedAmount}`;
};

export const formatDecimalValue = (value?: number) =>
  (Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(2);

export const formatNumber = (value?: number) =>
  new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
