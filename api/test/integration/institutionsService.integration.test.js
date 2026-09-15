const { pool } = require('../../src/db');
const { createInstitutionsService } = require('../../src/institutions/institutionsService');

const service = createInstitutionsService({ pool });

describe('institutionsService (against real Postgres)', () => {
  afterAll(async () => {
    await pool.end();
  });

  test('listInstitutions returns the seeded institutions, ordered by canonical_name', async () => {
    const institutions = await service.listInstitutions();
    const names = institutions.map((i) => i.canonical_name);
    expect(names).toContain('Chase');
    expect(names).toContain('Wells Fargo');
    expect([...names].sort()).toEqual(names);
  });

  test('listInstitutions includes each institution\'s aliases, sorted', async () => {
    const institutions = await service.listInstitutions();
    const chase = institutions.find((i) => i.canonical_name === 'Chase');
    expect(chase.aliases).toEqual(['Chase', 'Chase Bank', 'JPMorgan Chase', 'JPMorgan Chase Bank, N.A.']);
  });

  test('resolveInstitutionAlias matches the canonical name itself, case-insensitively', async () => {
    await expect(service.resolveInstitutionAlias('chase')).resolves.toBe('Chase');
  });

  test('resolveInstitutionAlias matches a known alias', async () => {
    await expect(service.resolveInstitutionAlias('JPMorgan Chase Bank, N.A.')).resolves.toBe('Chase');
    await expect(service.resolveInstitutionAlias('bofa')).resolves.toBe('Bank of America');
  });

  test('resolveInstitutionAlias returns null for an unknown institution', async () => {
    await expect(service.resolveInstitutionAlias('Some Random Credit Union')).resolves.toBeNull();
  });

  test('resolveInstitutionAlias returns null for empty or missing input', async () => {
    await expect(service.resolveInstitutionAlias('')).resolves.toBeNull();
    await expect(service.resolveInstitutionAlias('   ')).resolves.toBeNull();
    await expect(service.resolveInstitutionAlias(undefined)).resolves.toBeNull();
  });
});
