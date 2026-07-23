export const getJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || '').trim();

  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.');
  }

  return secret;
};
