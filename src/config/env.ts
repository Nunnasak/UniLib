export const getRequiredEnv = (name: string): string => {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
};

export const getPort = (): number => {
    const value = process.env.PORT ?? "3000";
    const port = Number(value);

    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error(`PORT must be a valid port number; received: ${value}`)
    }

    return port;
}