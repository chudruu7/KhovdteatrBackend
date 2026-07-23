import { createTestContext } from './testContext.js';

const PORT = 7101;
const ctx = await createTestContext();
await ctx.reset();

await ctx.createUser({
  name: 'Browser E2E Customer',
  email: 'browser.e2e@gmail.com',
  password: 'TestPass123!',
  phone: '99112233',
});

const { movie, schedule } = await ctx.createShowtime({ minutesFromNow: 60 });
const server = ctx.app.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({
    ready: true,
    apiUrl: `http://127.0.0.1:${PORT}/api`,
    email: 'browser.e2e@gmail.com',
    password: 'TestPass123!',
    movieId: String(movie._id),
    scheduleId: String(schedule._id),
  }));
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => server.close(resolve));
  await ctx.close();
  process.exit(0);
};

process.on('SIGINT', close);
process.on('SIGTERM', close);
