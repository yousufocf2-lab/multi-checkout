/** Meta charges 18% GST on every prepaid recharge: pay ₹1000, ₹847.46 reaches the ad account. */
export const GST = 0.18;
export const withGst = (rupees: number) => rupees * (1 + GST);
