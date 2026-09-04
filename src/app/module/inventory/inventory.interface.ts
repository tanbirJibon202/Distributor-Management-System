export type AdjustInventoryInput = {
  productId: string;
  branchId: string;
  quantity: number;
  reason: string;
};

export type RequestActor = {
  userId: string;
  role: string;
  branchId: string | null;
};
