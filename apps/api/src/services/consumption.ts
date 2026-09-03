import { addMoney, formatMoney, maxMoney, mulMoney, parseMoney, roundPyg, subMoney } from "@aguateria/shared";

export type TariffRuleCalc = {
  fixedCharge: string;
  minConsumptionM3: number;
  minAmount: string;
  pricePerM3: string;
  excessPricePerM3: string | null;
  surchargePercent: number;
  discountPercent: number;
  taxRate: number;
  taxExempt: boolean;
  pricesIncludeTax: boolean;
  /** Tasa ERSSAN sobre el neto de agua (exenta de IVA). En la boleta real es 2%. */
  erssanPercent?: number;
};

export type ConsumptionResult = {
  consumptionM3: number;
  minM3: number;
  excessM3: number;
  billedMinM3: number;
  minLiters: number;
  excessLiters: number;
  billedLiters: number;
  fixedCharge: string;
  consumptionAmount: string;
  excessAmount: string;
  surchargeAmount: string;
  discountAmount: string;
  waterGross: string;
  erssanAmount: string;
  minPayable: string;
  excessPayable: string;
  subtotal: string;
  taxAmount: string;
  total: string;
};

function m3Money(m3: number, price: string): string {
  return mulMoney(price, m3);
}

function excessUnitPrice(rule: TariffRuleCalc, minPay: string): string {
  if (rule.excessPricePerM3 && Number(rule.excessPricePerM3) > 0) return rule.excessPricePerM3;
  const minM3 = Math.max(0, rule.minConsumptionM3);
  if (minM3 > 0) {
    return formatMoney(parseMoney(minPay) / BigInt(Math.round(minM3)));
  }
  return rule.pricePerM3;
}

/** Parte el total a pagar como en la boleta: consumo con IVA 10% + ERSSAN 2% exento. */
export function splitIvaAndErssan(
  payable: string,
  ivaRate: number,
  erssanRate: number,
): { waterGross: string; erssanAmount: string; subtotal: string; taxAmount: string; total: string } {
  const total = roundPyg(payable);
  if (ivaRate <= 0 && erssanRate <= 0) {
    return { waterGross: total, erssanAmount: "0.00", subtotal: total, taxAmount: "0.00", total };
  }
  if (ivaRate <= 0) {
    const erssanAmount = roundPyg(mulMoney(total, erssanRate / (1 + erssanRate)));
    const waterGross = subMoney(total, erssanAmount);
    return { waterGross, erssanAmount, subtotal: waterGross, taxAmount: "0.00", total };
  }
  const denom = 1 + ivaRate + erssanRate;
  const waterGross = roundPyg(mulMoney(total, (1 + ivaRate) / denom));
  const erssanAmount = subMoney(total, waterGross);
  const subtotal = roundPyg(mulMoney(waterGross, 1 / (1 + ivaRate)));
  const taxAmount = subMoney(waterGross, subtotal);
  return { waterGross, erssanAmount, subtotal, taxAmount, total };
}

export function tariffRuleToCalc(
  rule: {
    fixedCharge: string;
    minConsumptionM3: string | number;
    minAmount: string;
    pricePerM3: string;
    excessPricePerM3: string | null;
    surchargePercent: string | number;
    discountPercent: string | number;
  },
  tax: { rate: number; exempt: boolean },
): TariffRuleCalc {
  const surcharge = Number(rule.surchargePercent);
  return {
    fixedCharge: rule.fixedCharge,
    minConsumptionM3: Number(rule.minConsumptionM3),
    minAmount: rule.minAmount,
    pricePerM3: rule.pricePerM3,
    excessPricePerM3: rule.excessPricePerM3,
    surchargePercent: Number.isFinite(surcharge) ? surcharge : 0,
    discountPercent: Number(rule.discountPercent),
    taxRate: tax.exempt ? 0 : tax.rate,
    taxExempt: tax.exempt,
    pricesIncludeTax: true,
    erssanPercent: surcharge > 0 ? surcharge : 2,
  };
}

/**
 * Motor de boleta de consumo, según aviso real de aguatería:
 * mínimo (p. ej. 10 m³ / 10.000 L) con importe a pagar, excedente por m³,
 * IVA 10% incluido en el agua y ERSSAN 2% sobre el neto (exento).
 */
export function calculateConsumption(consumptionM3: number, rule: TariffRuleCalc): ConsumptionResult {
  const consumption = Math.max(0, consumptionM3);
  const minM3 = Math.max(0, rule.minConsumptionM3);
  const excessM3 = Math.max(0, consumption - minM3);
  const billedMin = minM3;

  const minPayable = maxMoney(m3Money(minM3, rule.pricePerM3), rule.minAmount);
  const excessPayable = m3Money(excessM3, excessUnitPrice(rule, minPayable));
  let payable = addMoney(addMoney(minPayable, excessPayable), rule.fixedCharge);
  const discountAmount = mulMoney(payable, rule.discountPercent / 100);
  const afterDiscount = parseMoney(payable) - parseMoney(discountAmount);
  payable = formatMoney(afterDiscount < 0n ? 0n : afterDiscount);

  const ivaRate = !rule.taxExempt && rule.taxRate > 0 ? rule.taxRate : 0;
  const erssanRate = Math.max(0, (rule.erssanPercent ?? (rule.surchargePercent > 0 ? rule.surchargePercent : 2)) / 100);
  const split = splitIvaAndErssan(payable, ivaRate, erssanRate);

  return {
    consumptionM3: Number(consumption.toFixed(3)),
    minM3,
    excessM3: Number(excessM3.toFixed(3)),
    billedMinM3: Number(billedMin.toFixed(3)),
    minLiters: Math.round(minM3 * 1000),
    excessLiters: Math.round(excessM3 * 1000),
    billedLiters: Math.round((minM3 + excessM3) * 1000),
    fixedCharge: rule.fixedCharge,
    consumptionAmount: split.waterGross,
    excessAmount: excessPayable,
    surchargeAmount: split.erssanAmount,
    discountAmount,
    waterGross: split.waterGross,
    erssanAmount: split.erssanAmount,
    minPayable,
    excessPayable,
    subtotal: split.subtotal,
    taxAmount: split.taxAmount,
    total: split.total,
  };
}
