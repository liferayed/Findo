exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('institutions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    canonical_name: {
      type: 'text',
      notNull: true,
      unique: true,
    },
  });

  pgm.createTable('institution_aliases', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    institution_id: {
      type: 'uuid',
      notNull: true,
      references: 'institutions',
      onDelete: 'CASCADE',
    },
    alias: {
      type: 'text',
      notNull: true,
    },
  });

  pgm.sql('CREATE INDEX institution_aliases_alias_lower_idx ON institution_aliases (lower(alias));');

  // Seed data: a starter list of common US retail banks/card issuers. Each institution's own
  // canonical name is included as one of its own aliases, so a lookup only ever needs to query
  // institution_aliases — never institutions.canonical_name directly.
  pgm.sql(`
    WITH seed (canonical_name, aliases) AS (
      VALUES
        ('Chase', ARRAY['Chase', 'Chase Bank', 'JPMorgan Chase', 'JPMorgan Chase Bank, N.A.']),
        ('Bank of America', ARRAY['Bank of America', 'BofA', 'BankAmerica']),
        ('Wells Fargo', ARRAY['Wells Fargo', 'Wells Fargo Bank, N.A.']),
        ('Citibank', ARRAY['Citibank', 'Citi', 'Citibank, N.A.']),
        ('Capital One', ARRAY['Capital One', 'Capital One, N.A.']),
        ('US Bank', ARRAY['US Bank', 'U.S. Bank', 'U.S. Bank National Association']),
        ('PNC Bank', ARRAY['PNC Bank', 'PNC', 'PNC Bank, National Association']),
        ('American Express', ARRAY['American Express', 'Amex', 'American Express National Bank']),
        ('Discover', ARRAY['Discover', 'Discover Bank'])
    ),
    inserted_institutions AS (
      INSERT INTO institutions (canonical_name)
      SELECT canonical_name FROM seed
      RETURNING id, canonical_name
    )
    INSERT INTO institution_aliases (institution_id, alias)
    SELECT inserted_institutions.id, alias_value
    FROM inserted_institutions
    JOIN seed ON seed.canonical_name = inserted_institutions.canonical_name
    CROSS JOIN LATERAL unnest(seed.aliases) AS alias_value;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('institution_aliases');
  pgm.dropTable('institutions');
};
