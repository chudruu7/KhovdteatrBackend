require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const db = mongoose.connection.db;
    
    // First let's check what's wrong with them
    const docs = await db.collection('bookings').find({ 'customer.email': 'cashier@khovdteatr.mn' }).sort({createdAt:-1}).limit(10).toArray();
    console.log(docs.map(d => ({id: d._id, status: d.status, payment: d.payment.status})));

    // Restore cancelled cashier bookings that were wrongly marked as cancelled because they were pending
    const result = await db.collection('bookings').updateMany(
      { 'customer.email': 'cashier@khovdteatr.mn', 'status': 'cancelled' },
      { $set: { 'status': 'active' } }
    );
    console.log('Restored cancelled cashier bookings to active:', result.modifiedCount);
    
    // Just to be sure, also ensure any pending ones are paid
    const result2 = await db.collection('bookings').updateMany(
      { 'customer.email': 'cashier@khovdteatr.mn', 'payment.status': 'pending' },
      { $set: { 'payment.status': 'paid' } }
    );
    console.log('Fixed pending to paid:', result2.modifiedCount);

    mongoose.disconnect();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
