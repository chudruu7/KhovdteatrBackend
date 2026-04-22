import { requestCleanupApproval } from '../utils/cleanupService.js';

let lastCheckTime = null;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 цагт нэг удаа

export const autoCleanupMiddleware = async (req, res, next) => {
  const now = Date.now();
  const shouldCheck = !lastCheckTime || now - lastCheckTime > CHECK_INTERVAL_MS;

  if (shouldCheck) {
    lastCheckTime = now;
    setImmediate(() => requestCleanupApproval());
  }

  next();
};