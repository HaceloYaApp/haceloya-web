const FEE_RATE = 0.07;

// Comisión del 7% de la plataforma, redondeada a 2 decimales para evitar
// arrastre de flotantes (ej. 0.07 * 35000 = 2450.0000000000005).
export function platformFee(total: number): number {
  return Math.round(total * FEE_RATE * 100) / 100;
}

export type ProposalWarranty = { enabled?: boolean; cost?: number | null; accepted?: boolean } | null | undefined;

// Mismo cálculo que money.ts en la app mobile (base + comisión + garantía).
export function computeProposalTotal(input: {
  totalCost?: number | null;
  price?: number | null;
  warranty?: ProposalWarranty;
}): { base: number; fee: number; warrantyCost: number; total: number } {
  const base = Number(input.totalCost ?? input.price ?? 0) || 0;
  const fee = platformFee(base);
  const w = input.warranty;
  const cost = Number(w?.cost) || 0;
  const accepted = cost > 0 ? (w?.accepted ?? false) : false;
  const warrantyCost = w?.enabled && cost > 0 && accepted ? cost : 0;
  return { base, fee, warrantyCost, total: base + fee + warrantyCost };
}

export function formatARS(n: number | null | undefined): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
