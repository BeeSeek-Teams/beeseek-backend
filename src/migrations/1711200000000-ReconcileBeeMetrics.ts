import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time reconciliation: recalculate bee metrics from actual contract data.
 *
 * - totalHires = COUNT of contracts in PAID/IN_PROGRESS/COMPLETED status
 * - jobsCompleted = COUNT of contracts in COMPLETED status
 * - totalRevenue = SUM of (workmanshipCost - commissionAmount) for COMPLETED contracts
 */
export class ReconcileBeeMetrics1711200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Reset all bee metrics first, then recalculate from source of truth (contracts)

    // 1. Reconcile totalHires (contracts that were paid = actual hires)
    await queryRunner.query(`
      UPDATE "bee" b
      SET "totalHires" = COALESCE(sub.hire_count, 0)
      FROM (
        SELECT "beeId", COUNT(*) AS hire_count
        FROM "contract"
        WHERE "status" IN ('PAID', 'IN_PROGRESS', 'COMPLETED')
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);

    // 2. Reconcile jobsCompleted
    await queryRunner.query(`
      UPDATE "bee" b
      SET "jobsCompleted" = COALESCE(sub.completed_count, 0)
      FROM (
        SELECT "beeId", COUNT(*) AS completed_count
        FROM "contract"
        WHERE "status" = 'COMPLETED'
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);

    // 3. Reconcile totalRevenue (workmanshipCost - commissionAmount for completed contracts)
    await queryRunner.query(`
      UPDATE "bee" b
      SET "totalRevenue" = COALESCE(sub.total_revenue, 0)
      FROM (
        SELECT "beeId", SUM("workmanshipCost" - "commissionAmount") AS total_revenue
        FROM "contract"
        WHERE "status" = 'COMPLETED'
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reset all metrics to 0 (cannot reverse accurately)
    await queryRunner.query(`
      UPDATE "bee" SET "totalHires" = 0, "jobsCompleted" = 0, "totalRevenue" = 0
    `);
  }
}
