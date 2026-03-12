# Database Migrations

## How to use

### Generate a migration from entity changes
```bash
npm run migration:generate -- migrations/DescriptiveName
```

### Create an empty migration (for manual SQL)
```bash
npm run migration:create -- migrations/DescriptiveName
```

### Run pending migrations
```bash
npm run migration:run
```

### Revert last migration
```bash
npm run migration:revert
```

## Important
- **NEVER** set `synchronize: true` in production
- Always generate a migration after changing any entity
- Review the generated SQL before committing
- `migrationsRun: true` in database config means migrations auto-run on app start
