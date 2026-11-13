import { createHmac, timingSafeEqual } from "node:crypto";

type UndoReceipt = { playlistId: string; snapshotId: string; order: number[]; trackCount?: number; removedUris?: string[] };

function signature(payload: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for undo.");
  return createHmac("sha256", secret).update(payload).digest();
}

export function inverseOrder(order: number[]): number[] {
  if (new Set(order).size !== order.length || order.some((index) => !Number.isInteger(index) || index < 0 || index >= order.length)) throw new Error("Invalid move order");
  const inverse: number[] = new Array(order.length);
  order.forEach((original, current) => { inverse[original] = current; });
  return inverse;
}

export function createUndoReceipt(receipt: UndoReceipt): string {
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function readUndoReceipt(value: string, playlistId: string): UndoReceipt {
  const [payload, tag, extra] = value.split(".");
  if (!payload || !tag || extra) throw new Error("Invalid undo request");
  const supplied = Buffer.from(tag, "base64url");
  const expected = signature(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid undo request");
  const receipt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UndoReceipt;
  if (receipt.playlistId !== playlistId || typeof receipt.snapshotId !== "string" || !Array.isArray(receipt.order)) throw new Error("Invalid undo request");
  inverseOrder(receipt.order);
  if (receipt.removedUris !== undefined) {
    if (!Array.isArray(receipt.removedUris) || receipt.removedUris.some((uri) => typeof uri !== "string" || !/^spotify:(track|episode):[A-Za-z0-9]+$/.test(uri))) throw new Error("Invalid undo request");
    if (!Number.isInteger(receipt.trackCount) || receipt.trackCount! < 0 || receipt.trackCount! + receipt.removedUris.length !== receipt.order.length) throw new Error("Invalid undo request");
  } else if (receipt.trackCount !== undefined && receipt.trackCount !== receipt.order.length) throw new Error("Invalid undo request");
  return receipt;
}
