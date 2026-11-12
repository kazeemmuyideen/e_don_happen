export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  environment: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '55432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    name: process.env.DB_NAME || 'neighbourhood_signal_demo',
    synchronize: process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production',
    logging: process.env.DB_LOGGING === 'true',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '56379', 10),
  },
  nipost: {
    apiKey: process.env.NIPOST_API_KEY || '',
    baseUrl:
      process.env.NIPOST_BASE_URL || 'https://api.postcode.gov.ng',
    lookupLevel: parseInt(process.env.NIPOST_LOOKUP_LEVEL || '1', 10),
  },
  evidence: {
    storageDir: process.env.EVIDENCE_STORAGE_DIR || '.local/evidence',
    maxBytes: parseInt(process.env.EVIDENCE_MAX_BYTES || '5242880', 10),
  },
});
