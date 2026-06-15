import mongoose from 'mongoose';
mongoose.connect('mongodb://localhost:27017/cinema', {}).then(async () => {
  const db = mongoose.connection.db;
  const res = await db.collection('bookings').aggregate([
    {
      $group: {
        _id: '$movie',
        totalRevenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
        payments: { $push: { method: { $ifNull: ['$payment.method', 'other'] }, amount: { $ifNull: ['$totalPrice', 0] } } },
        tickets: { $push: { seats: { $ifNull: ['$seats', []] }, tickets: { $ifNull: ['$tickets', []] } } }
      }
    }
  ]).toArray();
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
});
