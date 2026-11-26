import { Prisma, StockMovementType } from "@prisma/client";
import { prisma } from "../lib/prisma";

export class InsufficientStockError extends Error {
  constructor(skuId: string) {
    super(`Insufficient stock for SKU ${skuId}`);
    this.name = "InsufficientStockError";
  }
}

export async function adjustInventory(params: {
  skuId: string;
  warehouseId: string;
  quantityDelta: number;
  movementType: StockMovementType;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
}) {
  return prisma.$transaction(async (tx) => {
    const existingLedger = await tx.stockLedger.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existingLedger) {
      return tx.inventory.findUniqueOrThrow({
        where: {
          skuId_warehouseId: {
            skuId: params.skuId,
            warehouseId: params.warehouseId,
          },
        },
      });
    }

    const rows = await tx.$queryRaw<Array<{ id: string; available: number }>>`
      SELECT id, available FROM "Inventory"
      WHERE "skuId" = ${params.skuId} AND "warehouseId" = ${params.warehouseId}
      FOR UPDATE
    `;

    let inventoryId: string;
    if (rows.length === 0) {
      if (params.quantityDelta < 0) {
        throw new InsufficientStockError(params.skuId);
      }
      const created = await tx.inventory.create({
        data: {
          skuId: params.skuId,
          warehouseId: params.warehouseId,
          available: params.quantityDelta,
          reserved: 0,
        },
      });
      inventoryId = created.id;
    } else {
      const nextAvailable = rows[0].available + params.quantityDelta;
      if (nextAvailable < 0) {
        throw new InsufficientStockError(params.skuId);
      }
      inventoryId = rows[0].id;
      await tx.inventory.update({
        where: { id: inventoryId },
        data: {
          available: nextAvailable,
          version: { increment: 1 },
        },
      });
    }

    await tx.stockLedger.create({
      data: {
        inventoryId,
        movementType: params.movementType,
        quantityDelta: params.quantityDelta,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        idempotencyKey: params.idempotencyKey,
      },
    });

    return tx.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
  });
}

export async function reserveStockInTx(
  tx: Prisma.TransactionClient,
  params: {
    skuId: string;
    warehouseId: string;
    orderId: string;
    quantity: number;
    expiresAt: Date;
    idempotencyKey: string;
  }
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string; available: number; reserved: number }>
  >`
    SELECT id, available, reserved FROM "Inventory"
    WHERE "skuId" = ${params.skuId} AND "warehouseId" = ${params.warehouseId}
    FOR UPDATE
  `;

  if (rows.length === 0 || rows[0].available < params.quantity) {
    throw new InsufficientStockError(params.skuId);
  }

  const inv = rows[0];
  await tx.inventory.update({
    where: { id: inv.id },
    data: {
      available: inv.available - params.quantity,
      reserved: inv.reserved + params.quantity,
      version: { increment: 1 },
    },
  });

  await tx.stockLedger.create({
    data: {
      inventoryId: inv.id,
      movementType: "RESERVE",
      quantityDelta: -params.quantity,
      referenceType: "Order",
      referenceId: params.orderId,
      idempotencyKey: params.idempotencyKey,
    },
  });

  return tx.reservation.create({
    data: {
      skuId: params.skuId,
      warehouseId: params.warehouseId,
      orderId: params.orderId,
      quantity: params.quantity,
      status: "ACTIVE",
      expiresAt: params.expiresAt,
    },
  });
}

export async function expireReservationById(reservationId: string) {
  return prisma.$transaction(async (tx) => {
    const res = await tx.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!res || res.status !== "ACTIVE") {
      return { skipped: true };
    }

    const rows = await tx.$queryRaw<
      Array<{ id: string; available: number; reserved: number }>
    >`
      SELECT id, available, reserved FROM "Inventory"
      WHERE "skuId" = ${res.skuId} AND "warehouseId" = ${res.warehouseId}
      FOR UPDATE
    `;

    if (rows.length > 0) {
      const inv = rows[0];
      const releaseQty = Math.min(res.quantity, inv.reserved);
      await tx.inventory.update({
        where: { id: inv.id },
        data: {
          available: inv.available + releaseQty,
          reserved: inv.reserved - releaseQty,
          version: { increment: 1 },
        },
      });

      const ledgerKey = `expire:${res.id}`;
      const existing = await tx.stockLedger.findUnique({
        where: { idempotencyKey: ledgerKey },
      });
      if (!existing) {
        await tx.stockLedger.create({
          data: {
            inventoryId: inv.id,
            movementType: "RELEASE",
            quantityDelta: releaseQty,
            referenceType: "Reservation",
            referenceId: res.id,
            idempotencyKey: ledgerKey,
          },
        });
      }
    }

    await tx.reservation.update({
      where: { id: res.id },
      data: { status: "EXPIRED" },
    });

    if (res.orderId) {
      await tx.order.updateMany({
        where: { id: res.orderId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    }

    return { skipped: false, reservationId: res.id };
  });
}
