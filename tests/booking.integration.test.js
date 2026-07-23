import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createTestContext } from './helpers/testContext.js';
import { validateFirebaseClaims } from '../src/services/socialIdentityService.js';

let ctx;
let users;
let tokens;
let showtime;

test('Firebase claim validation accepts normal clock skew and optional auth_time', () => {
  const now = 1_700_000_000;

  assert.equal(validateFirebaseClaims({ sub: 'firebase-user', iat: now + 60 }, now, 300), true);
  assert.equal(validateFirebaseClaims({ sub: 'firebase-user', iat: now, auth_time: now + 60 }, now, 300), true);
  assert.equal(validateFirebaseClaims({ sub: 'firebase-user', iat: now + 301 }, now, 300), false);
  assert.equal(validateFirebaseClaims({ sub: 'firebase-user', iat: now, auth_time: now + 301 }, now, 300), false);
  assert.equal(validateFirebaseClaims({ sub: '', iat: now }, now, 300), false);
});

before(async () => {
  ctx = await createTestContext();
}, { timeout: 900000 });

after(async () => {
  if (ctx) await ctx.close();
});

beforeEach(async () => {
  await ctx.reset();
  users = {
    owner: await ctx.createUser({ name: 'Owner', email: 'owner@gmail.com' }),
    other: await ctx.createUser({ name: 'Other', email: 'other@gmail.com' }),
    cashier: await ctx.createUser({ name: 'Cashier', email: 'cashier@gmail.com', role: 'cashier' }),
    admin: await ctx.createUser({ name: 'Admin', email: 'admin-test@gmail.com', role: 'admin' }),
  };
  tokens = {
    owner: await ctx.login('owner@gmail.com'),
    other: await ctx.login('other@gmail.com'),
    cashier: await ctx.login('cashier@gmail.com'),
    admin: await ctx.login('admin-test@gmail.com'),
  };
  showtime = await ctx.createShowtime();
});

test('auth rejects missing/tampered tokens and public registration cannot grant privileged roles', async () => {
  const anonymous = await ctx.api
    .post('/api/bookings')
    .send(ctx.bookingPayload({ schedule: showtime.schedule }));
  assert.equal(anonymous.status, 401);

  const tampered = await ctx.api
    .get('/api/auth/me')
    .set(ctx.auth(`${tokens.owner}tampered`));
  assert.equal(tampered.status, 401);

  const registered = await ctx.api.post('/api/auth/register').send({
    name: 'Cannot Self Promote',
    email: 'self.promote@gmail.com',
    password: 'TestPass123!',
    role: 'admin',
  });
  assert.equal(registered.status, 201, registered.text);
  assert.equal(registered.body.user.role, 'user');

  const authenticated = await ctx.api
    .get('/api/auth/me')
    .set(ctx.auth(registered.body.token));
  assert.equal(authenticated.status, 200, authenticated.text);
  assert.equal(authenticated.body.user.role, 'user');

  const privateProfile = await ctx.api
    .get(`/api/auth/profile/${users.owner._id}`)
    .set(ctx.auth(tokens.other));
  assert.equal(privateProfile.status, 403);

  const forgedSocialLogin = await ctx.api.post('/api/auth/social-login').send({
    provider: 'google',
    email: users.cashier.email,
    providerId: 'attacker-controlled-id',
  });
  assert.equal(forgedSocialLogin.status, 400);
  assert.equal(forgedSocialLogin.body.token, undefined);
});

test('cash payment trusts authenticated staff role, not client flags or cashier email', async () => {
  const forged = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.owner))
    .send({
      ...ctx.bookingPayload({ schedule: showtime.schedule, paymentMethod: 'cash' }),
      isCashier: true,
      customer: {
        name: 'Forged Cashier',
        email: 'cashier@khovdteatr.mn',
        phone: '99001122',
      },
    });

  assert.equal(forged.status, 403);
  let freshSchedule = await ctx.models.Schedule.findById(showtime.schedule._id).lean();
  assert.deepEqual(freshSchedule.soldSeats, []);

  const cashSale = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.cashier))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, paymentMethod: 'cash' }));

  assert.equal(cashSale.status, 201, cashSale.text);
  const booking = await ctx.models.Booking.findById(cashSale.body.bookingId).lean();
  assert.equal(booking.payment.status, 'paid');
  assert.equal(booking.payment.method, 'cash');
  assert.equal(String(booking.payment.receivedBy), String(users.cashier._id));
  assert.ok(booking.payment.receivedAt);
  assert.match(booking.payment.transactionId, /^CASH-/);
  assert.equal(booking.totalPrice, 15000, 'server must ignore the forged totalPrice=1');

  freshSchedule = await ctx.models.Schedule.findById(showtime.schedule._id).lean();
  assert.deepEqual(freshSchedule.soldSeats, ['A1']);
});

test('only the owner can cancel an unpaid booking; cancelling releases the seat', async () => {
  const created = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.owner))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, seat: 'A2' }));
  assert.equal(created.status, 201, created.text);

  const forbidden = await ctx.api
    .post(`/api/bookings/${created.body.bookingId}/cancel`)
    .set(ctx.auth(tokens.other))
    .send({});
  assert.equal(forbidden.status, 403);
  assert.ok(await ctx.models.Booking.findById(created.body.bookingId));

  const hiddenFromOtherUser = await ctx.api
    .get(`/api/bookings/${created.body.bookingId}`)
    .set(ctx.auth(tokens.other));
  assert.equal(hiddenFromOtherUser.status, 403);

  const publicVerification = await ctx.api
    .get(`/api/bookings/verify/${created.body.bookingId}`);
  assert.equal(publicVerification.status, 200, publicVerification.text);
  assert.equal('customerEmail' in publicVerification.body.booking, false);
  assert.equal('customerPhone' in publicVerification.body.booking, false);
  assert.equal('transactionId' in publicVerification.body.booking, false);

  const paymentForbidden = await ctx.api
    .post('/api/wire/checkout')
    .set(ctx.auth(tokens.other))
    .send({ bookingId: created.body.bookingId });
  assert.equal(paymentForbidden.status, 403);

  const cancelled = await ctx.api
    .post(`/api/bookings/${created.body.bookingId}/cancel`)
    .set(ctx.auth(tokens.owner))
    .send({});
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(cancelled.body.deleted, true);
  assert.equal(await ctx.models.Booking.findById(created.body.bookingId), null);

  const schedule = await ctx.models.Schedule.findById(showtime.schedule._id).lean();
  assert.deepEqual(schedule.soldSeats, []);
});

test('a paid ticket cannot be cancelled by its cashier owner, but admin can cancel it', async () => {
  const created = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.cashier))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, seat: 'A3', paymentMethod: 'cash' }));
  assert.equal(created.status, 201, created.text);

  const cashierCancel = await ctx.api
    .post(`/api/bookings/${created.body.bookingId}/cancel`)
    .set(ctx.auth(tokens.cashier))
    .send({});
  assert.equal(cashierCancel.status, 403);

  const adminCancel = await ctx.api
    .post(`/api/bookings/${created.body.bookingId}/cancel`)
    .set(ctx.auth(tokens.admin))
    .send({ reason: 'Integration test cancellation' });
  assert.equal(adminCancel.status, 200, adminCancel.text);

  const booking = await ctx.models.Booking.findById(created.body.bookingId).lean();
  assert.equal(booking.status, 'cancelled');
  assert.equal(booking.payment.status, 'paid');
  assert.equal(String(booking.cancellation.cancelledBy), String(users.admin._id));
  assert.equal(booking.cancellation.reason, 'Integration test cancellation');

  const schedule = await ctx.models.Schedule.findById(showtime.schedule._id).lean();
  assert.deepEqual(schedule.soldSeats, []);
});

test('two simultaneous requests for one seat produce exactly one booking', async () => {
  const payload = ctx.bookingPayload({ schedule: showtime.schedule, seat: 'B1' });
  const [first, second] = await Promise.all([
    ctx.api.post('/api/bookings').set(ctx.auth(tokens.owner)).send(payload),
    ctx.api.post('/api/bookings').set(ctx.auth(tokens.other)).send(payload),
  ]);

  assert.deepEqual([first.status, second.status].sort(), [201, 409]);
  assert.equal(await ctx.models.Booking.countDocuments({ schedule: showtime.schedule._id, seats: 'B1' }), 1);
  const schedule = await ctx.models.Schedule.findById(showtime.schedule._id).lean();
  assert.deepEqual(schedule.soldSeats, ['B1']);
});

test('only a valid signed Wire webhook marks a booking paid and duplicate delivery is idempotent', async () => {
  const created = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.owner))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, seat: 'B2' }));
  assert.equal(created.status, 201, created.text);

  const checkout = await ctx.api
    .post('/api/wire/checkout')
    .set(ctx.auth(tokens.owner))
    .send({ bookingId: created.body.bookingId });
  assert.equal(checkout.status, 201, checkout.text);
  const paymentIntentId = checkout.body.data.paymentIntentId;

  const event = {
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        metadata: { booking_id: created.body.bookingId },
      },
    },
  };
  const rawBody = JSON.stringify(event);

  const invalid = await ctx.api
    .post('/api/wire/webhook')
    .set('Content-Type', 'application/json')
    .set('WirePayment-Signature', 't=1,v1=00')
    .send(rawBody);
  assert.equal(invalid.status, 400);
  let booking = await ctx.models.Booking.findById(created.body.bookingId).lean();
  assert.equal(booking.payment.status, 'pending');

  const signature = ctx.signWebhook(rawBody);
  const paid = await ctx.api
    .post('/api/wire/webhook')
    .set('Content-Type', 'application/json')
    .set('WirePayment-Signature', signature)
    .send(rawBody);
  assert.equal(paid.status, 200, paid.text);

  const duplicate = await ctx.api
    .post('/api/wire/webhook')
    .set('Content-Type', 'application/json')
    .set('WirePayment-Signature', signature)
    .send(rawBody);
  assert.equal(duplicate.status, 200, duplicate.text);

  booking = await ctx.models.Booking.findById(created.body.bookingId).lean();
  assert.equal(booking.payment.status, 'paid');
  assert.equal(booking.payment.transactionId, paymentIntentId);
  assert.equal(await ctx.models.Booking.countDocuments({ _id: created.body.bookingId }), 1);
});

test('admin-only booking reports stay forbidden to ordinary users and manual confirm is removed', async () => {
  const userList = await ctx.api.get('/api/bookings').set(ctx.auth(tokens.owner));
  assert.equal(userList.status, 403);

  const adminList = await ctx.api.get('/api/bookings').set(ctx.auth(tokens.admin));
  assert.equal(adminList.status, 200);

  const created = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.owner))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, seat: 'C1' }));
  const confirm = await ctx.api
    .post(`/api/bookings/${created.body.bookingId}/confirm`)
    .set(ctx.auth(tokens.owner))
    .send({ paymentMethod: 'wire' });
  assert.equal(confirm.status, 404);
});

test('financial reports count only paid bookings as revenue and expose unpaid bookings separately', async () => {
  const paid = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.cashier))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, seat: 'D1', paymentMethod: 'cash' }));
  assert.equal(paid.status, 201, paid.text);

  const unpaid = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.owner))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, seat: 'D2', paymentMethod: 'wire' }));
  assert.equal(unpaid.status, 201, unpaid.text);

  const dashboard = await ctx.api
    .get('/api/reports/dashboard')
    .set(ctx.auth(tokens.admin));
  assert.equal(dashboard.status, 200, dashboard.text);
  assert.equal(dashboard.body.summary.bookingCount, 2);
  assert.equal(dashboard.body.summary.paidBookingCount, 1);
  assert.equal(dashboard.body.summary.ticketCount, 1);
  assert.equal(dashboard.body.summary.totalRevenue, 15000);
  assert.equal(dashboard.body.summary.paidRevenue, 15000);
  assert.equal(dashboard.body.summary.unpaidRevenue, 15000);

  const transactions = await ctx.api
    .get('/api/reports/financial/transactions')
    .set(ctx.auth(tokens.admin));
  assert.equal(transactions.status, 200, transactions.text);
  assert.deepEqual(
    new Set(transactions.body.data.map((row) => row.paymentStatus)),
    new Set(['paid', 'pending']),
  );
});

test('disabled email notifications suppress automatic ticket email while explicit resend still works', async () => {
  users.owner.notifications = false;
  await users.owner.save();
  const pointsBeforePayment = users.owner.points;

  const created = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(tokens.owner))
    .send(ctx.bookingPayload({ schedule: showtime.schedule, seat: 'E1', paymentMethod: 'wire' }));
  assert.equal(created.status, 201, created.text);

  const { markBookingPaidAndNotify } = await import('../src/services/bookingFulfillmentService.js');
  const fulfilled = await markBookingPaidAndNotify({
    bookingId: created.body.bookingId,
    paymentMethod: 'wire',
    transactionId: 'preference-test-payment',
    awaitEmail: true,
  });

  assert.equal(fulfilled.emailResult.success, false);
  assert.equal(fulfilled.emailResult.skipped, true);
  assert.equal(fulfilled.emailResult.reason, 'notifications_disabled');

  let rewardedUser = await ctx.models.User.findById(users.owner._id).lean();
  assert.equal(rewardedUser.points, pointsBeforePayment + 1);

  await markBookingPaidAndNotify({
    bookingId: created.body.bookingId,
    paymentMethod: 'wire',
    transactionId: 'preference-test-payment',
    awaitEmail: true,
  });
  rewardedUser = await ctx.models.User.findById(users.owner._id).lean();
  assert.equal(rewardedUser.points, pointsBeforePayment + 1);

  let booking = await ctx.models.Booking.findById(created.body.bookingId).lean();
  assert.equal(booking.ticketEmailSentAt, null);
  assert.ok(booking.ticketEmailSuppressedAt);

  const resent = await ctx.api
    .post(`/api/bookings/${created.body.bookingId}/resend-confirmation`)
    .set(ctx.auth(tokens.owner))
    .send({});
  assert.equal(resent.status, 200, resent.text);
  assert.equal(resent.body.success, true);
  assert.equal(resent.body.email.success, true);

  booking = await ctx.models.Booking.findById(created.body.bookingId).lean();
  assert.ok(booking.ticketEmailSentAt);
  assert.equal(booking.ticketEmailSuppressedAt, null);
});
