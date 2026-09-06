export const roundMoney = (amount: number): number =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

export const calculateDamageCharges = (
  acquisitionPrice: number,
  condition: "NORMAL" | "MINOR_DAMAGE" | "MAJOR_DAMAGE" | "UNUSABLE",
): { damageCharge: number; processingFee: number } => {
  switch (condition) {
    case "NORMAL":
      return { damageCharge: 0, processingFee: 0 };
    case "MINOR_DAMAGE":
      return { damageCharge: 100, processingFee: 0 };
    case "MAJOR_DAMAGE":
      return { damageCharge: roundMoney(acquisitionPrice * 0.5), processingFee: 0 };
    case "UNUSABLE":
      return { damageCharge: roundMoney(acquisitionPrice), processingFee: 200 };
  }
};
