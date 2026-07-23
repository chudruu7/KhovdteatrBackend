// src/middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getJwtSecret } from '../utils/jwtSecret.js';

export const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            const decoded = jwt.verify(token, getJwtSecret());

            req.user = await User.findById(decoded.id).select('-password -socialAccounts');

            // ── ЗАСАЛТ: эхлээд шалгаад, дараа next() дуудна ──
            if (!req.user) {
                return res.status(401).json({ message: 'Хэрэглэгч олдсонгүй' });
            }

            return next(); // ← зөвхөн нэг удаа

        } catch (error) {
            if (process.env.NODE_ENV !== 'test') {
                console.warn('Token verification failed:', error.name);
            }
            return res.status(401).json({ message: 'Токен буруу эсвэл хугацаа нь дууссан' });
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'Токен олдсонгүй, нэвтрэх шаардлагатай' });
    }
};

export const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Админ эрхээр нэвтэрнэ үү' });
    }
};

export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Нэвтрэх шаардлагатай' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                message: `Таны эрх (${req.user.role}) энэ үйлдэл хийхэд зөвшөөрөгдөхгүй`
            });
        }
        next();
    };
};
