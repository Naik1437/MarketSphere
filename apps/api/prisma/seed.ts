import bcrypt from "bcryptjs";
import { PrismaClient, Role, SellerStatus, ProductStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const demoPassword = process.env.DEMO_SEED_PASSWORD || "DemoPass!2026";
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  const demoUsers = [
    {
      email: "customer1@marketsphere.local",
      fullName: "Aarav Customer",
      role: Role.CUSTOMER,
    },
    {
      email: "customer2@marketsphere.local",
      fullName: "Diya Customer",
      role: Role.CUSTOMER,
    },
    {
      email: "seller1@marketsphere.local",
      fullName: "Kiran Seller One",
      role: Role.SELLER,
    },
    {
      email: "seller2@marketsphere.local",
      fullName: "Meera Seller Two",
      role: Role.SELLER,
    },
    {
      email: "warehouse@marketsphere.local",
      fullName: "Vikram Warehouse",
      role: Role.WAREHOUSE_OPERATOR,
    },
    {
      email: "support@marketsphere.local",
      fullName: "Neha Support",
      role: Role.SUPPORT_AGENT,
    },
    {
      email: "admin@marketsphere.local",
      fullName: "Rohan Admin",
      role: Role.ADMIN,
    },
  ];

  const usersByEmail = new Map<string, { id: string; email: string }>();

  for (const u of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        role: u.role,
        passwordHash,
        isActive: true,
      },
      create: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        passwordHash,
        isActive: true,
      },
      select: { id: true, email: true },
    });
    usersByEmail.set(u.email, user);
  }

  const seller1User = usersByEmail.get("seller1@marketsphere.local")!;
  const seller2User = usersByEmail.get("seller2@marketsphere.local")!;

  const seller1 = await prisma.seller.upsert({
    where: { userId: seller1User.id },
    update: {
      businessName: "Kiran Electronics",
      slug: "kiran-electronics",
      status: SellerStatus.ACTIVE,
    },
    create: {
      userId: seller1User.id,
      businessName: "Kiran Electronics",
      slug: "kiran-electronics",
      status: SellerStatus.ACTIVE,
      commissionRate: "10.00",
    },
  });

  const seller2 = await prisma.seller.upsert({
    where: { userId: seller2User.id },
    update: {
      businessName: "Meera Home Goods",
      slug: "meera-home-goods",
      status: SellerStatus.ACTIVE,
    },
    create: {
      userId: seller2User.id,
      businessName: "Meera Home Goods",
      slug: "meera-home-goods",
      status: SellerStatus.ACTIVE,
      commissionRate: "12.00",
    },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { code: "WH-BLR-01" },
    update: { name: "Bengaluru Central", region: "ap-south-1", isActive: true },
    create: {
      code: "WH-BLR-01",
      name: "Bengaluru Central",
      region: "ap-south-1",
      isActive: true,
    },
  });

  const prod1 = await prisma.product.upsert({
    where: {
      sellerId_slug: { sellerId: seller1.id, slug: "wireless-mouse-pro" },
    },
    update: { status: ProductStatus.ACTIVE },
    create: {
      sellerId: seller1.id,
      name: "Wireless Mouse Pro",
      slug: "wireless-mouse-pro",
      description: "Ergonomic wireless mouse",
      category: "Electronics",
      status: ProductStatus.ACTIVE,
    },
  });

  const prod2 = await prisma.product.upsert({
    where: {
      sellerId_slug: { sellerId: seller2.id, slug: "ceramic-mug-set" },
    },
    update: { status: ProductStatus.ACTIVE },
    create: {
      sellerId: seller2.id,
      name: "Ceramic Mug Set",
      slug: "ceramic-mug-set",
      description: "Set of 2 handcrafted mugs",
      category: "Home",
      status: ProductStatus.ACTIVE,
    },
  });

  const sku1 = await prisma.sku.upsert({
    where: { skuCode: "KIRAN-MOUSE-001" },
    update: { price: "1499.00", isActive: true },
    create: {
      productId: prod1.id,
      skuCode: "KIRAN-MOUSE-001",
      title: "Matte Black",
      price: "1499.00",
      currency: "INR",
      isActive: true,
    },
  });

  const sku2 = await prisma.sku.upsert({
    where: { skuCode: "MEERA-MUG-001" },
    update: { price: "799.00", isActive: true },
    create: {
      productId: prod2.id,
      skuCode: "MEERA-MUG-001",
      title: "Sandstone 300ml",
      price: "799.00",
      currency: "INR",
      isActive: true,
    },
  });

  await prisma.inventory.upsert({
    where: {
      skuId_warehouseId: { skuId: sku1.id, warehouseId: warehouse.id },
    },
    update: {},
    create: {
      skuId: sku1.id,
      warehouseId: warehouse.id,
      available: 25,
      reserved: 0,
    },
  });

  await prisma.inventory.upsert({
    where: {
      skuId_warehouseId: { skuId: sku2.id, warehouseId: warehouse.id },
    },
    update: {},
    create: {
      skuId: sku2.id,
      warehouseId: warehouse.id,
      available: 40,
      reserved: 0,
    },
  });

  console.log("[seed] idempotent demo data ready (7 users, 2 sellers, 1 warehouse, 2 SKUs)");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
