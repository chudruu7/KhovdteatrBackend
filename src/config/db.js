// src/config/db.js

import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // 8.0-аас хойш default болсон тул заавал бичих шаардлагагүй ч, хуучин хувилбарт хэрэгтэй байсан
      // useNewUrlParser: true, 
      // useUnifiedTopology: true,
    });

    console.log(`✅ MongoDB амжилттай холбогдлоо: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB холболтын алдаа: ${error.message}`);
    process.exit(1); // Аппликейшнийг зогсоох
  }
};

export default connectDB;