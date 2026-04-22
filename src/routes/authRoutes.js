// src/routes/authRoutes.js
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { protect } from '../middleware/authMiddleware.js';
const router = express.Router();

// Бүртгүүлэх
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, avatarUrl } = req.body;

    const existingUser = await User.findOne({ email });
if (existingUser) {
  // ЭНЭ ХЭСЭГ ингэж болсон уу?
  if (avatarUrl) {
    existingUser.avatarUrl = avatarUrl;
    await existingUser.save();
  }
  return res.status(200).json({
    success: true,
    message: 'Хэрэглэгч аль хэдийн бүртгэгдсэн, нэвтэрнэ үү.'
  });
}

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const isAdmin = email === 'admin@cinema.mn';

    const user = new User({
      name,
      email,
      password: hashedPassword,
      role: isAdmin ? 'admin' : 'user',
      avatarUrl: avatarUrl || '' // ← avatarUrl хадгалах (User.js pre-save hook дүүргэнэ)
    });

    await user.save();

    res.status(201).json({ 
      success: true, 
      message: 'Бүртгэл амжилттай үүслээ' 
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Сервер дээр алдаа гарлаа' 
    });
  }
});

// Нэвтрэх
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Имэйл эсвэл нууц үг буруу байна.' 
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Имэйл эсвэл нууц үг буруу байна.' 
      });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'mysecretkey',
      { expiresIn: '7d' }
    );

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone || '',
      address: user.address || '',
      avatarUrl: user.avatarUrl || '', 
      membershipLevel: user.membershipLevel || 'standard',
      points: user.points || 0
    };

    res.json({
      success: true,
      token,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Сервер дээр алдаа гарлаа' 
    });
  }
});

// Хэрэглэгчийн мэдээлэл авах
router.get('/profile/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Хэрэглэгч олдсонгүй' });
    }
    res.json(user);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Сервер дээр алдаа гарлаа' });
  }
});
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, phone, address, notifications } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name, phone, address, notifications },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Шинэчлэхэд алдаа гарлаа', error: err.message });
  }
});
export default router;