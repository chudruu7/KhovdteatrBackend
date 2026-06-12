import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

const createToken = (user) => jwt.sign(
  { id: user._id, email: user.email, role: user.role },
  process.env.JWT_SECRET || 'mysecretkey',
  { expiresIn: '7d' }
);

const toUserData = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone || '',
  address: user.address || '',
  avatarUrl: user.avatarUrl || '',
  membershipLevel: user.membershipLevel || 'standard',
  points: user.points || 0,
  notifications: user.notifications ?? true,
  smsAlerts: user.smsAlerts ?? false,
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, avatarUrl, phone } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (normalizedEmail !== 'admin@cinema.mn' && !normalizedEmail.endsWith('@gmail.com')) {
      return res.status(400).json({
        success: false,
        message: 'Зөвхөн Gmail хаягаар бүртгүүлэх боломжтой.',
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Хэрэглэгч аль хэдийн бүртгэлтэй байна.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const isAdmin = normalizedEmail === 'admin@cinema.mn';

    const user = new User({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: isAdmin ? 'admin' : 'user',
      phone: phone || '',
      avatarUrl: avatarUrl || '',
    });

    await user.save();

    return res.status(201).json({
      success: true,
      token: createToken(user),
      user: toUserData(user),
      message: 'Бүртгэл амжилттай үүслээ',
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      message: 'Сервер дээр алдаа гарлаа',
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Имэйл эсвэл нууц үг буруу байна.',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Имэйл эсвэл нууц үг буруу байна.',
      });
    }

    return res.json({
      success: true,
      token: createToken(user),
      user: toUserData(user),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Сервер дээр алдаа гарлаа',
    });
  }
});

router.post('/social-login', async (req, res) => {
  try {
    const { name, email, avatarUrl, provider, providerId } = req.body;
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const isGoogleProvider = ['google', 'google.com'].includes(normalizedProvider);

    if (!normalizedEmail || !providerId || !normalizedProvider) {
      return res.status(400).json({
        success: false,
        message: 'Social login мэдээлэл дутуу байна.',
      });
    }

    if (!isGoogleProvider) {
      return res.status(400).json({
        success: false,
        message: 'Зөвхөн Google/Gmail бүртгэлээр нэвтрэх боломжтой.',
      });
    }

    if (!normalizedEmail.endsWith('@gmail.com')) {
      return res.status(400).json({
        success: false,
        message: 'Зөвхөн Gmail хаягаар бүртгүүлэх болон нэвтрэх боломжтой.',
      });
    }

    let user = await User.findOne({ email: normalizedEmail });
    let isNewUser = false;
    const fallbackPassword = `${normalizedProvider}:${providerId}`;

    if (!user) {
      isNewUser = true;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(fallbackPassword, salt);
      user = new User({
        name: name || 'Хэрэглэгч',
        email: normalizedEmail,
        password: hashedPassword,
        role: normalizedEmail === 'admin@cinema.mn' ? 'admin' : 'user',
        avatarUrl: avatarUrl || '',
      });
      await user.save();
    } else {
      const update = {};
      if (name && user.name !== name) {
        update.name = name;
      }
      if (avatarUrl && user.avatarUrl !== avatarUrl) {
        update.avatarUrl = avatarUrl;
      }
      if (!user.password) {
        const salt = await bcrypt.genSalt(10);
        update.password = await bcrypt.hash(fallbackPassword, salt);
      }
      if (Object.keys(update).length > 0) {
        user = await User.findByIdAndUpdate(user._id, update, { new: true });
      }
    }

    return res.json({
      success: true,
      token: createToken(user),
      user: toUserData(user),
      isNewUser,
    });
  } catch (error) {
    console.error('Social login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Social login хийхэд сервер дээр алдаа гарлаа',
    });
  }
});

router.get('/me', protect, async (req, res) => {
  return res.json({ success: true, user: req.user });
});

router.get('/profile/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Хэрэглэгч олдсонгүй' });
    }
    return res.json(user);
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ message: 'Сервер дээр алдаа гарлаа' });
  }
});

router.put('/profile', protect, async (req, res) => {
  try {
    const { name, phone, address, notifications, avatarUrl } = req.body;

    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (address !== undefined) update.address = address;
    if (notifications !== undefined) update.notifications = notifications;
    if (avatarUrl !== undefined) update.avatarUrl = avatarUrl;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      update,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'Хэрэглэгч олдсонгүй' });
    }

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Шинэчлэхэд алдаа гарлаа',
      error: err.message,
    });
  }
});

export default router;
