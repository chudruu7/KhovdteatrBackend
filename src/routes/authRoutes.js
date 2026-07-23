import express from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { protect } from '../middleware/authMiddleware.js';
import { getJwtSecret } from '../utils/jwtSecret.js';
import { verifySocialIdentity } from '../services/socialIdentityService.js';

const router = express.Router();

const createToken = (user) => jwt.sign(
  { id: user._id, email: user.email, role: user.role },
  getJwtSecret(),
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

    if (!normalizedEmail.endsWith('@gmail.com')) {
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
    const user = new User({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: 'user',
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
    const { provider, idToken, accessToken } = req.body;
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const isGoogleProvider = ['google', 'google.com'].includes(normalizedProvider);

    if (!normalizedProvider || (!idToken && !accessToken)) {
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

    const identity = await verifySocialIdentity({ idToken, accessToken });
    const normalizedEmail = identity.email;
    const providerId = identity.providerId;

    if (!normalizedEmail.endsWith('@gmail.com')) {
      return res.status(400).json({
        success: false,
        message: 'Зөвхөн Gmail хаягаар бүртгүүлэх болон нэвтрэх боломжтой.',
      });
    }

    let user = await User.findOne({
      socialAccounts: { $elemMatch: { provider: 'google', providerId } },
    });
    if (!user) user = await User.findOne({ email: normalizedEmail });
    let isNewUser = false;
    const randomPassword = () => crypto.randomBytes(32).toString('hex');

    if (!user) {
      isNewUser = true;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(randomPassword(), salt);
      user = new User({
        name: identity.name || 'Хэрэглэгч',
        email: normalizedEmail,
        password: hashedPassword,
        role: 'user',
        avatarUrl: identity.avatarUrl || '',
        socialAccounts: [{ provider: 'google', providerId }],
      });
      await user.save();
    } else {
      const update = {};
      if (identity.name && user.name !== identity.name) {
        update.name = identity.name;
      }
      if (identity.avatarUrl && user.avatarUrl !== identity.avatarUrl) {
        update.avatarUrl = identity.avatarUrl;
      }
      if (!user.socialAccounts?.some((account) => account.provider === 'google' && account.providerId === providerId)) {
        update.$push = { socialAccounts: { provider: 'google', providerId } };
      }
      const legacyFallbackPassword = `${normalizedProvider}:${providerId}`;
      const usesLegacyFallback = user.password
        ? await bcrypt.compare(legacyFallbackPassword, user.password)
        : true;
      if (usesLegacyFallback) {
        const salt = await bcrypt.genSalt(10);
        update.password = await bcrypt.hash(randomPassword(), salt);
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
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Social login rejected:', error.message);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Social login хийхэд сервер дээр алдаа гарлаа',
    });
  }
});

router.get('/me', protect, async (req, res) => {
  return res.json({ success: true, user: req.user });
});

router.get('/profile/:id', protect, async (req, res) => {
  try {
    const isOwner = String(req.user?._id) === String(req.params.id);
    if (!isOwner && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Энэ хэрэглэгчийн профайлыг харах эрхгүй байна.' });
    }

    const user = await User.findById(req.params.id).select('-password -socialAccounts');
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
    ).select('-password -socialAccounts');

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
