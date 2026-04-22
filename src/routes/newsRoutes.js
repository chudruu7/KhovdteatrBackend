// src/routes/newsRoutes.js

import express from 'express';
import { 
    getNews,
    getNewsById,
    createNews,
    updateNews,
    deleteNews
} from '../controllers/newsController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Нийтийн route-ууд
router.get('/', getNews);
router.get('/:id', getNewsById);

// Админы route-ууд (хамгаалагдсан)
router.post('/', protect, admin, createNews);

router.put('/:id', protect, admin, updateNews);
router.delete('/:id', protect, admin, deleteNews);

export default router;