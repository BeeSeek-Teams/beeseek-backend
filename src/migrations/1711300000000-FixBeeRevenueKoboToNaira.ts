import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix bee totalRevenue:
 * 1. Previous migration stored raw kobo values (workmanship - commission) without converting to naira
 * 2. Revenue should include full agent earnings: totalCost - commission (transport + materials + workmanship - commission)
 * 3. Convert kobo → naira by dividing by 100
 */
export class FixBeeRevenueKoboToNaira1711300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Recalculate totalRevenue from contracts using full agent earnings (totalCost - commission) in naira
    await queryRunner.query(`
      UPDATE "bees" b
      SET "totalRevenue" = COALESCE(sub.total_revenue, 0) / 100
      FROM (
        SELECT "beeId", SUM("totalCost" - "commissionAmount") AS total_revenue
        FROM "contracts"
        WHERE "status" = 'COMPLETED'
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);

    // Reset bees with no completed contracts to 0
    await queryRunner.query(`
      UPDATE "bees" SET "totalRevenue" = 0
      WHERE id NOT IN (
        SELECT DISTINCT "beeId" FROM "contracts" WHERE "status" = 'COMPLETED'
      ) AND "totalRevenue" != 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to previous (incorrect) calculation
    await queryRunner.query(`
      UPDATE "bees" b
      SET "totalRevenue" = COALESCE(sub.total_revenue, 0)
      FROM (
        SELECT "beeId", SUM("workmanshipCost" - "commissionAmount") AS total_revenue
        FROM "contracts"
        WHERE "status" = 'COMPLETED'
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);
  }
}
