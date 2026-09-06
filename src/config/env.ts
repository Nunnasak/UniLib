export const getRequiredEnv = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const parsePort = (name: string, value: string): number => {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${name} must be a valid port number; received: ${value}`);
  }

  return port;
};

export const getDatabaseUrl = (): string => {
  const databaseUrl = new URL(getRequiredEnv("DATABASE_URL"));
  const portOverride = process.env.DATABASE_PORT_OVERRIDE;

  if (portOverride) {
    databaseUrl.port = String(parsePort("DATABASE_PORT_OVERRIDE", portOverride));
  }

  return databaseUrl.toString();
};

export const getPort = (): number => {
  return parsePort("PORT", process.env.PORT ?? "3000");
};
