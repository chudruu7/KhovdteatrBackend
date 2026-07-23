import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

const TEST_DB_NAME = 'cinema_integration_test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'cinema-integration-test-secret-not-for-production';
process.env.WIRE_OPERATION_MODE = 'sandbox';
process.env.WIRE_TEST_MODE = 'true';
process.env.WIRE_API_KEY = 'sk_test_local_integration';
process.env.WIRE_WEBHOOK_SECRET = 'wire-integration-test-secret';
process.env.PUBLIC_API_URL = 'http://127.0.0.1:7101';
process.env.FRONTEND_URL = 'http://127.0.0.1:8082';
process.env.RESEND_API_KEY = '';
process.env.GMAIL_USER = '';
process.env.GMAIL_APP_PASS = '';
process.env.EMAIL_USER = '';
process.env.EMAIL_PASS = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

const assertEphemeralDatabase = () => {
  const host = mongoose.connection.host;
  const name = mongoose.connection.name;
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), `Unsafe test database host: ${host}`);
  assert.ok(name.endsWith('_test'), `Unsafe test database name: ${name}`);
};

export const createTestContext = async () => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri(TEST_DB_NAME);
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\]):/);
  assert.ok(uri.includes(TEST_DB_NAME));

  await mongoose.connect(uri);
  assertEphemeralDatabase();

  const [
    { default: app },
    { default: User },
    { default: Movie },
    { default: Schedule },
    { default: Booking },
  ] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/models/User.js'),
    import('../../src/models/Movie.js'),
    import('../../src/models/Schedule.js'),
    import('../../src/models/Booking.js'),
  ]);

  const api = request(app);

  const reset = async () => {
    assertEphemeralDatabase();
    await Promise.all(
      Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({}))
    );
  };

  const close = async () => {
    assertEphemeralDatabase();
    await mongoose.disconnect();
    await mongo.stop();
  };

  const createUser = async ({
    name,
    email,
    role = 'user',
    password = 'TestPass123!',
    phone = '',
  }) => User.create({
    name,
    email: email.toLowerCase(),
    role,
    phone,
    password: await bcrypt.hash(password, 4),
  });

  const login = async (email, password = 'TestPass123!') => {
    const response = await api.post('/api/auth/login').send({ email, password });
    assert.equal(response.status, 200, response.text);
    assert.ok(response.body.token);
    return response.body.token;
  };

  const createShowtime = async ({ minutesFromNow = 60 } = {}) => {
    const movie = await Movie.create({
      title: `Integration Test Movie ${Date.now()}`,
      duration: '120 мин',
      genre: ['Test'],
      status: 'nowShowing',
      adultPrice: 15000,
      childPrice: 10000,
    });
    const schedule = await Schedule.create({
      movie: movie._id,
      showTime: new Date(Date.now() + minutesFromNow * 60 * 1000),
      hall: {
        hallName: 'Test Hall',
        rows: 4,
        seatsPerRow: 5,
        totalSeats: 20,
      },
      soldSeats: [],
      basePrice: 15000,
      childPrice: 10000,
    });
    return { movie, schedule };
  };

  const bookingPayload = ({ schedule, seat = 'A1', paymentMethod = 'wire' }) => ({
    scheduleId: String(schedule._id),
    seats: [{ seatId: seat, type: 'adult' }],
    totalPrice: 1,
    customer: {
      name: 'Test Customer',
      email: 'test.customer@gmail.com',
      phone: '99001122',
    },
    paymentMethod,
  });

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const signWebhook = (rawBody, timestamp = Math.floor(Date.now() / 1000)) => {
    const digest = crypto
      .createHmac('sha256', process.env.WIRE_WEBHOOK_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    return `t=${timestamp},v1=${digest}`;
  };

  return {
    app,
    api,
    mongo,
    models: { User, Movie, Schedule, Booking },
    reset,
    close,
    createUser,
    login,
    createShowtime,
    bookingPayload,
    auth,
    signWebhook,
  };
};
