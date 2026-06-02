import crypto from 'crypto';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { admin, protect } from '../middleware/authMiddleware.js';

const router = express.Router();
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'images');

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

router.post(
  '/image',
  protect,
  admin,
  express.raw({
    type: Object.keys(EXT_BY_TYPE),
    limit: MAX_IMAGE_SIZE,
  }),
  async (req, res) => {
    try {
      const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
      const ext = EXT_BY_TYPE[contentType];

      if (!ext) {
        return res.status(400).json({
          success: false,
          message: 'Зөвхөн JPG, PNG, WEBP, GIF зураг upload хийнэ үү.',
        });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Upload хийх зураг олдсонгүй.',
        });
      }

      if (req.body.length > MAX_IMAGE_SIZE) {
        return res.status(413).json({
          success: false,
          message: 'Зургийн хэмжээ 10MB-аас бага байх ёстой.',
        });
      }

      await fs.mkdir(UPLOAD_DIR, { recursive: true });

      const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const filePath = path.join(UPLOAD_DIR, filename);
      await fs.writeFile(filePath, req.body);

      const protocol = req.get('x-forwarded-proto') || req.protocol;
      const url = `${protocol}://${req.get('host')}/uploads/images/${filename}`;
      return res.status(201).json({ success: true, url });
    } catch (error) {
      console.error('Image upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Зураг upload хийхэд алдаа гарлаа.',
      });
    }
  }
);

export default router;
