import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixAdminForeignKeyCascade1710500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing FK constraints that RESTRICT admin deletion, recreate with SET NULL

    // support_messages.adminId → administrators.id
    await queryRunner.query(`
      ALTER TABLE "support_messages"
      DROP CONSTRAINT IF EXISTS "FK_19053b06672fb852d3dffa57e94"
    `);
    await queryRunner.query(`
      ALTER TABLE "support_messages"
      ADD CONSTRAINT "FK_19053b06672fb852d3dffa57e94"
      FOREIGN KEY ("adminId") REFERENCES "administrators"("id")
      ON DELETE SET NULL
    `);

    // support_tickets.assignedAdminId → administrators.id
    // Find the actual constraint name first, then recreate
    await queryRunner.query(`
      DO $$
      DECLARE
        constraint_name text;
      BEGIN
        SELECT tc.constraint_name INTO constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'support_tickets'
          AND kcu.column_name = 'assignedAdminId'
          AND tc.constraint_type = 'FOREIGN KEY';

        IF constraint_name IS NOT NULL THEN
          EXECUTE 'ALTER TABLE "support_tickets" DROP CONSTRAINT "' || constraint_name || '"';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "support_tickets"
      ADD CONSTRAINT "FK_support_tickets_assignedAdminId"
      FOREIGN KEY ("assignedAdminId") REFERENCES "administrators"("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to RESTRICT (default)
    await queryRunner.query(`
      ALTER TABLE "support_messages"
      DROP CONSTRAINT IF EXISTS "FK_19053b06672fb852d3dffa57e94"
    `);
    await queryRunner.query(`
      ALTER TABLE "support_messages"
      ADD CONSTRAINT "FK_19053b06672fb852d3dffa57e94"
      FOREIGN KEY ("adminId") REFERENCES "administrators"("id")
    `);

    await queryRunner.query(`
      ALTER TABLE "support_tickets"
      DROP CONSTRAINT IF EXISTS "FK_support_tickets_assignedAdminId"
    `);
    await queryRunner.query(`
      ALTER TABLE "support_tickets"
      ADD CONSTRAINT "FK_support_tickets_assignedAdminId"
      FOREIGN KEY ("assignedAdminId") REFERENCES "administrators"("id")
    `);
  }
}
