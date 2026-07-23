import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestContext } from './helpers/testContext.js';

let ctx;

before(async () => {
  ctx = await createTestContext();
  await ctx.reset();
}, { timeout: 900000 });

after(async () => {
  if (ctx) await ctx.close();
});

test('complete customer booking: register → select show → reserve seat → Wire webhook → ticket → cashier admission', async () => {
  const cashier = await ctx.createUser({
    name: 'E2E Cashier',
    email: 'e2e.cashier@gmail.com',
    role: 'cashier',
  });
  assert.ok(cashier._id);
  const cashierToken = await ctx.login('e2e.cashier@gmail.com');
  const { movie, schedule } = await ctx.createShowtime({ minutesFromNow: 10 });

  const registration = await ctx.api.post('/api/auth/register').send({
    name: 'E2E Customer',
    email: 'e2e.customer@gmail.com',
    password: 'E2ePass123!',
    phone: '99112233',
  });
  assert.equal(registration.status, 201, registration.text);
  const customerToken = registration.body.token;

  const movies = await ctx.api.get('/api/movies');
  assert.equal(movies.status, 200, movies.text);
  const movieList = [
    ...(movies.body.nowShowing || []),
    ...(movies.body.comingSoon || []),
  ];
  assert.ok(movieList.some((item) => String(item._id) === String(movie._id)));

  const schedules = await ctx.api.get(`/api/schedules/${movie._id}`);
  assert.equal(schedules.status, 200, schedules.text);
  assert.ok(schedules.body.some((item) => String(item._id) === String(schedule._id)));

  const reservation = await ctx.api
    .post('/api/bookings')
    .set(ctx.auth(customerToken))
    .send({
      ...ctx.bookingPayload({ schedule, seat: 'D1' }),
      customer: {
        name: 'E2E Customer',
        email: 'e2e.customer@gmail.com',
        phone: '99112233',
      },
    });
  assert.equal(reservation.status, 201, reservation.text);
  const bookingId = reservation.body.bookingId;

  const checkout = await ctx.api
    .post('/api/wire/checkout')
    .set(ctx.auth(customerToken))
    .send({ bookingId });
  assert.equal(checkout.status, 201, checkout.text);
  const paymentIntentId = checkout.body.data.paymentIntentId;

  const event = {
    type: 'payment_intent.succeeded',
    data: { object: { id: paymentIntentId, metadata: { booking_id: bookingId } } },
  };
  const rawBody = JSON.stringify(event);
  const webhook = await ctx.api
    .post('/api/wire/webhook')
    .set('Content-Type', 'application/json')
    .set('WirePayment-Signature', ctx.signWebhook(rawBody))
    .send(rawBody);
  assert.equal(webhook.status, 200, webhook.text);

  const ticket = await ctx.api
    .get(`/api/bookings/${bookingId}`)
    .set(ctx.auth(customerToken));
  assert.equal(ticket.status, 200, ticket.text);
  assert.equal(ticket.body.booking.paymentStatus, 'paid');
  assert.deepEqual(ticket.body.booking.seats, ['D1']);

  const customerProfile = await ctx.api
    .get('/api/auth/me')
    .set(ctx.auth(customerToken));
  assert.equal(customerProfile.status, 200, customerProfile.text);
  assert.equal(customerProfile.body.user.points, 1);

  const cashierView = await ctx.api
    .get(`/api/cashier/tickets/${bookingId}`)
    .set(ctx.auth(cashierToken));
  assert.equal(cashierView.status, 200, cashierView.text);
  assert.equal(cashierView.body.booking.admission.allowed, true);

  const admission = await ctx.api
    .post(`/api/cashier/tickets/${bookingId}/admit`)
    .set(ctx.auth(cashierToken))
    .send({});
  assert.equal(admission.status, 200, admission.text);
  assert.equal(admission.body.booking.status, 'used');

  const duplicateAdmission = await ctx.api
    .post(`/api/cashier/tickets/${bookingId}/admit`)
    .set(ctx.auth(cashierToken))
    .send({});
  assert.equal(duplicateAdmission.status, 409);
});
