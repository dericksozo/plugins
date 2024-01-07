/***
 * This file was auto-generated by Amplication and should not be modified by hand.
 * The file will be re-generated with every new build, and all changes will be lost.
 * To add a custom seed script, you can safely edit the content of ./customSeed.ts
 ***/

import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { customSeed } from "./customSeed";

declare const DATA: { username: string };

if (require.main === module) {
  dotenv.config();

  seed().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function seed() {
  console.info("Seeding database...");

  const client = new PrismaClient();
  const data = DATA;
  await client.user.create({
    data,
  });
  void client.$disconnect();

  console.info("Seeding database with custom seed...");
  customSeed();

  console.info("Seeded database successfully");
}
