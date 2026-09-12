require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://findo:findo@localhost:5432/findo',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
};

module.exports = { config };
