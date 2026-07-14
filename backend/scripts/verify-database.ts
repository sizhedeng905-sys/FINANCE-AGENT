import { Prisma, PrismaClient } from '@prisma/client';

interface NameRow {
  name: string;
}

interface DatabaseContextRow {
  database: string;
  schema: string;
}

const prisma = new PrismaClient();

async function main() {
  const [databaseContext] = await prisma.$queryRaw<DatabaseContextRow[]>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  const expectedTables = Prisma.dmmf.datamodel.models
    .map((model) => model.dbName ?? model.name)
    .sort();
  const actualTables = (
    await prisma.$queryRaw<NameRow[]>`
      SELECT tablename AS name
      FROM pg_catalog.pg_tables
      WHERE schemaname = current_schema()
      ORDER BY tablename
    `
  ).map((row) => row.name);
  const enumNames = await prisma.$queryRaw<NameRow[]>`
    SELECT type.typname AS name
    FROM pg_catalog.pg_type type
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = current_schema()
      AND type.typtype = 'e'
    ORDER BY type.typname
  `;
  const indexNames = await prisma.$queryRaw<NameRow[]>`
    SELECT indexname AS name
    FROM pg_catalog.pg_indexes
    WHERE schemaname = current_schema()
    ORDER BY indexname
  `;
  const foreignKeys = await prisma.$queryRaw<NameRow[]>`
    SELECT constraint_name AS name
    FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
      AND constraint_type = 'FOREIGN KEY'
    ORDER BY constraint_name
  `;

  const missingTables = expectedTables.filter((name) => !actualTables.includes(name));
  const unexpectedTables = actualTables.filter((name) => !expectedTables.includes(name) && name !== '_prisma_migrations');

  console.log(
    JSON.stringify(
      {
        database: databaseContext.database,
        schema: databaseContext.schema,
        expectedTables,
        actualTables,
        missingTables,
        unexpectedTables,
        enums: enumNames.map((row) => row.name),
        indexCount: indexNames.length,
        foreignKeyCount: foreignKeys.length
      },
      null,
      2
    )
  );

  if (missingTables.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
